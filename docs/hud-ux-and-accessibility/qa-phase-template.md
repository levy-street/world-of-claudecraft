# QA Phase Starter Prompt Template (HUD Visual + UX + Accessibility)

This ONE template is reused for EVERY QA phase in the packet: the standalone QA
phases (2, 4, 6, 8, 20, 22, 24, 26), each per-window QA in the 9-18 band, and
Phase 28 (which is the final QA AND additionally runs packet teardown). Do not
fork a new file per phase; copy the block below and substitute N.

How to parameterize N:
- For a standalone QA phase, N is the EVEN phase number and it verifies the
  immediately preceding ODD implementation phase (Phase 2 verifies Phase 1,
  Phase 4 verifies Phase 3, ..., Phase 26 verifies Phase 25).
- For a per-window QA (the 9-18 band), N names the window (for example "Phase 10
  QA, Bags") and it verifies that window's impl pass, which was authored from
  `phase-window-polish-template.md`. Use the window's ARIA widget row from
  `implementation-plan.md` (Per-window pass order) when filling the spec checks.
- For Phase 28, N = 28; it verifies Phase 27 AND, only when the whole packet is
  green, runs STEP 5 packet teardown. For every other QA phase, STEP 5 is SKIPPED.

Replace every `<N>`, `<phase-start-commit>`, and `<predecessor>` placeholder
before pasting. Anchors (line numbers) drift; the prompt tells the runner to
re-grep named symbols, not trust line numbers. Reference docs by path; do not
paste their content. Cite `research-brief.md` for ARIA/contrast specifics.

---

### QA Starter Prompt

```
This is Phase <N> QA of the HUD Visual + UX + Accessibility feature: Verify
<predecessor impl phase title, e.g. "Phase 1 - Design-token system + dark-fantasy
palette" or "Phase 10 - Bags window visual + AAA a11y pass">.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: if the verified phase was a11y-heavy or large (Phases 3, 7, the 9-18
window passes, 19, 21, 23, 25, 27), add `ultracode` and run the audit as an
adversarial-verify Workflow: fan out the audit agents, then have a fresh agent
try to BREAK each acceptance claim (find a missing aria state, an English leak, a
per-frame getComputedStyle, an unreviewed snapshot) before you conclude PASS.

GOAL: audit Phase <N-impl> for correctness, missing tests, dead code,
accessibility conformance (axe-core plus a manual screen-reader pass where the
phase touches the SR/announcer surface), i18n completeness (no English leak in
any label/tooltip/announcement), visual correctness (deliberate re-baseline only,
no masked regression), determinism, and the per-frame budget. Apply blocking and
should-fix issues, then hand off.

STEP 0 - PRE-FLIGHT (stop if any check fails):
- `git status` must be clean and the Phase <N-impl> work committed. This is a
  SHARED worktree with concurrent sessions: if the tree is dirty, do NOT stash or
  revert; ask the user whose work it is before touching anything.
- Confirm the cross-packet checkpoint this phase rides on is still satisfied (the
  refactor phase the impl needed, per `state.md` "Cross-packet dependency"). If
  the modular seam the phase used has since regressed or moved, STOP and surface.
- Memory scan: read MEMORY.md plus the notes for hud, i18n, shared-worktree,
  never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds.
- You stay ON the Phase <N-impl> branch `feature/<card>-<slug>` (QA fixes commit
  onto the same branch). Do NOT branch off and do NOT push to the fork; origin is
  levy-street only, and only when the user asks.

STEP 1 - LOAD CONTEXT (do NOT read planning docs or `src/ui/hud.ts` in the main
loop). Spawn ONE Explore agent and have it return a tight written summary of:
  - `docs/hud-ux-and-accessibility/state.md` (locked decisions, the non-negotiable
    invariants by number, the validation matrix, the review-dispatch matrix, the
    ledger rows the impl phase claims to have added).
  - The `research-brief.md` sections the phase claimed to meet, fetched by the
    widgets/criteria actually touched: section 2 (the WCAG 2.2 SC table with
    thresholds), section 3 (the per-widget ARIA role/state/keyboard specs),
    section 4 (the real-time SR + focus model: input-mode gate, focus-trap/inert/
    Escape-stack, announcer coalescing) and/or section 5 (token taxonomy,
    QUALITY_COLOR migration, theme swap, text-scale) and/or section 6 (mobile/
    pointer) as relevant.
  - `docs/hud-ux-and-accessibility/progress.md` for Phase <N-impl>: its
    deliverables, its acceptance criteria, AND the shared "QA phase checklists".
  - This phase's impl starter prompt (or `phase-window-polish-template.md` if
    Phase <N-impl> is a per-window pass) to recover its stated scope and
    out-of-scope list.
  - ALL files changed in Phase <N-impl>: run `git diff --name-only
    <phase-start-commit>..HEAD` and have the agent read each, plus re-grep named
    anchors (for example `QUALITY_COLOR`, `readToken`, `inputMode`, `role="grid"`,
    `aria-modal`, the announcer singleton, the window's module export) rather than
    trusting any line number.
Give the agents in STEP 2 ONLY this Explore summary, never the raw docs.

STEP 2 - QA AUDIT (fan out these agents in parallel; prompt EACH for COVERAGE not
filtering: "report every issue you find at any severity; do not pre-filter to the
top few; if you run low on room, stop reading and emit the full report now"):

  - Correctness agent: every Phase <N-impl> deliverable and acceptance criterion
    in `progress.md` is actually met (not just claimed); logic bugs; and NO
    functional regression. The refactor preserved real behavior, so confirm the
    underlying gameplay/HUD behavior the phase restyled or instrumented STILL
    works (windows open/close, slots assign, tooltips populate, frames update).
    Where the surface exists in both worlds, confirm offline `Sim` and online
    `ClientWorld` parity via `IWorld` (no concrete `Sim`/`ClientWorld` reach).

  - Accessibility agent: verify the ARIA roles/states/keyboard model for every
    widget the phase touched MATCHES `research-brief.md` section 3 (dialog/
    alertdialog, menu, tablist, tooltip parallel-description, grid, listbox, live
    regions, meter, progressbar, slider). Then run the axe-core checks and confirm
    keyboard-only operation, visible focus (2.4.7) that survives the dark backdrop
    and is non-text >=3:1 (1.4.11), focus not obscured by the action bar/chat/
    frames (2.4.11) with scroll-padding, no keyboard trap (2.1.2), roving tabindex
    with exactly one tabstop per composite (action bar `role="toolbar"`, bag grid),
    modal focus-trap + restore to opener (2.4.3), target size (2.5.8, 24x24 with
    the spacing exception; 48px primary touch hit areas per section 6), contrast
    (1.4.3 text 4.5:1 / large 3:1, 1.4.11 non-text 3:1, and 1.4.6 7:1 / 4.5:1
    AAA wherever the phase CLAIMED AAA), reduced motion actually SKIPS the per-frame
    FCT/shake work (not just hides it), and single-pointer alternatives exist for
    every drag and pinch (2.5.7 / 2.5.1). For announcer/Reader-Mode surfaces,
    confirm the live-region channels (`role="log"` / `role="status"` / `role="alert"`,
    polite-by-default, assertive only for true emergencies), the coalescing/queue
    cap, `aria-atomic` on composite status, and that announcements fire on STATE
    CHANGE not per frame.

  - Test-coverage agent: find new code paths shipped without tests; ADD the
    missing unit tests and axe assertions; for an Edit Mode phase add/confirm the
    localStorage persistence round-trip test (save layout, reload, assert
    restored); remove orphaned tests the impl left behind; confirm assertions are
    meaningful (not `expect(true)` shells). New a11y utilities each get unit
    coverage; `tests/tokens.test.ts` confirms tokens resolve and the QUALITY_COLOR
    mapping is intact where Phase 1 is in scope.

  - Dead-code / cleanup agent: unused imports/types/functions; the IMPORT
    invariant (`src/sim/` imports nothing from `render/`/`ui/`/`game/`/`net/`; new
    HUD modules import only `IWorld` plus helpers plus `HudContext`, never `Sim`/
    `ClientWorld` concretely); no commented-out code, no TODO/FIXME left behind, no
    em dashes, no emojis in code/comments/strings; and confirm token reads on the
    canvas hot path go through the CACHED `readToken()` (NO per-frame
    `getComputedStyle`) and the hot-write dedup extends to aria attributes.

  Then the multi-agent review dispatch (from `state.md` review-dispatch matrix):
  run `git diff --name-only <phase-start-commit>..HEAD` and spawn ONLY the agents
  whose surface the diff actually touches:
    - `qa-checklist`: ALWAYS, every QA phase.
    - `cross-platform-sync`: ONLY if the diff touched `src/world_api.ts`,
      `src/sim/` behavior/observations/`SimEvent`, `src/net/online.ts`,
      `server/game.ts` wire/dispatch, the `sim_i18n`/`server_i18n` matchers, or the
      RL surface. This packet is client-only and is NOT expected to touch these; if
      it did, STOP and surface (a new `IWorld` member is a red flag per the locked
      decisions).
    - `migration-safety` AND `privacy-security-review`: ONLY if Edit Mode added
      server-side layout sync (the OPEN `characters.state` path) or a CI/secret/
      deploy file changed. Default localStorage avoids both.
  Resume any agent that truncates with exactly: "Stop reading. Output the full
  report now."

STEP 2b - LIVE-GAME QA (Playwright MCP; follow `research-brief.md` and the
`state.md` validation matrix). Run `npm run dev` (and `npm run server` too if the
surface is online-only) and drive the running game:
  - Exercise the surfaces Phase <N-impl> touched with KEYBOARD ONLY (Tab/Shift+Tab,
    arrows, Home/End, Enter/Space, Escape) and confirm a visible focus indicator at
    every stop and that focus is never trapped or obscured.
  - Switch the locale (use `supportedLanguages`, not a printed list) and confirm
    NO English leak in any label, tooltip, placeholder, announcement, or
    `document.title`: read the accessibility tree, not just the pixels.
  - Toggle themes (default / high-contrast / Okabe-Ito colorblind), the text-scale
    multiplier, and Reader Mode WHERE the phase added or touched them, and confirm
    each actually applies (recolor via `data-theme`, type grows via `--text-scale`,
    announcer channels activate only in Reader Mode).
  - For canvas surfaces the a11y tree cannot see (minimap, FCT, character preview,
    procedural icons/slots), screenshot the canvas AND assert state through the
    `window.__game` debug hook plus the parallel hidden DOM/live-region text
    equivalent.
  - Confirm the Playwright DOM visual baselines changed ONLY where the phase
    intended: review the visual diff. An unintended pixel change is a regression,
    not a re-baseline; do not accept a snapshot update that masks one.
  - ONLINE MODE (ClientWorld): for any phase that touches HUD behavior (player/
    target frames, nameplates, cast bar, auras, window open/update, Social online
    announcements, live regions), run the surface against `npm run server` IN
    ADDITION to the offline `Sim` walkthrough, mirroring the refactor packet. Confirm
    window open/update and live regions behave correctly across interest-scoped
    (~120 yd) partial-snapshot churn and target loss (entities entering/leaving
    interest mid-run), and that offline `Sim` and online `ClientWorld` reach parity
    through `IWorld` (no concrete `Sim`/`ClientWorld` reach).
  - For an a11y-heavy phase (3, 7, the 9-18 window passes, 19, 21, 23, 25, 27) do a
    MANUAL screen-reader pass with VoiceOver or NVDA and RECORD exactly what was
    and was not announced (target change, cast start/interrupt, cooldown ready,
    loot, level up, connection lost), and note SR queue lag if any.

STEP 3 - FIX: apply ALL blocking and should-fix issues directly (defer only
nice-to-have, recorded for handoff). Re-run the full validation matrix for the
change type from `state.md`:
  - `npx tsc --noEmit`
  - the phase's vitest files plus `npx vitest run tests/hud_harness.test.ts
    tests/hud_perf_budget.test.ts` (skip rate must stay > 0.8)
  - the axe assertions (`npx vitest run tests/a11y/*.test.ts` and/or
    `npx playwright test tests/a11y`) for any a11y change
  - `npx vitest run tests/localization_fixes.test.ts` (the i18n guard: every new
    label is a `t()` key)
  - `npx playwright test`, then re-baseline deliberately with
    `npx playwright test --update-snapshots` ONLY after you have reviewed the
    visual diff
  - the CI-equivalent gate ONCE before the verdict: `npm test && npx tsc --noEmit
    && npm run build:env && npm run build:server && npm run build` (the final
    `npm run build` must show the game bundle does NOT pull in the dev-only
    axe-core / @axe-core/playwright deps)
  Commit the QA fixes SEPARATELY from the verdict, with explicit paths (never
  `git add -A`).

STEP 4 - UPDATE DOCS + MEMORY:
  - Mark Phase <N> QA complete in `docs/hud-ux-and-accessibility/progress.md`
    (the status table and the per-window tracker row if a window pass).
  - Record any drift, deviation, or resolution in
    `docs/hud-ux-and-accessibility/state.md` (ledger, gotchas, OPEN items).
  - Add concise memory notes (new tokens/utilities/keys discovered, any gotcha for
    the next phase).
  Commit docs with explicit paths.

STEP 5 - PACKET TEARDOWN (PHASE 28 ONLY, and ONLY when the entire packet is green;
for EVERY other QA phase SKIP this step entirely):
  - First surface ALL deferred follow-ups in plain language, including the Edit
    Mode server-sync OPEN item (`characters.state` layout sync was deliberately
    deferred in favor of localStorage) and any nice-to-have a11y items left
    unaddressed.
  - Then ask the user, in plain language, for EXPLICIT confirmation to delete the
    planning scaffolding `docs/hud-ux-and-accessibility/` before the PR.
  - On a yes: delete ONLY that directory, by exact path (`git rm -r
    docs/hud-ux-and-accessibility` if tracked, else `rm -rf`), and commit
    `docs: remove hud-ux-and-accessibility planning scaffolding`.
  - On a no: leave it in place. Never `git add -A`; never touch any other path.

STEP 6 - FINAL RESPONSE FORMAT (return as your final message):
  - QA verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
  - Counts: blocking, should-fix, and nice-to-have issues FOUND and FIXED.
  - Files touched (absolute paths).
  - Validation results: tsc, phase tests, harness + perf skip rate, axe, the
    manual SR pass (what was / was not announced), the reviewed visual baseline,
    the i18n guard, and the CI-equivalent gate.
  - Review verdicts: each spawned review agent and its result.
  - Deferrals: anything left for a follow-up.
  - Teardown status: Phase 28 only (done / declined / pending user confirm);
    otherwise N/A.
  - One-line handoff to the next phase (or "packet complete" on Phase 28).

STOPPING RULES (stop and surface; do not force a PASS):
  - Any blocking fix would require a new `IWorld` member, a `src/sim/`/`server/`/
    wire change, or a new player-facing string that cannot be expressed as a `t()`
    key. These are out of scope for a client-only a11y/visual packet.
  - A visual re-baseline looks like it would MASK an unintended regression (a pixel
    change the phase did not intend).
  - The worktree is dirty with another session's in-progress work.
  - The cross-packet refactor checkpoint this phase depended on is no longer met.
```
