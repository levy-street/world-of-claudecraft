# Phase 3 (impl): A11y interaction foundation on HudContext

Paste the fenced block below into a fresh Claude Code session. It is
self-contained: it does not assume any prior context beyond the repo and the
packet docs it tells you to read.

### Starter Prompt

```
This is Phase 3 of the HUD Visual + UX + Accessibility feature: A11y interaction
foundation on HudContext.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (three independent utility surfaces A/B/C
plus their tests, touching input.ts, keybinds.ts, and a new a11y/ directory).
Add `ultracode` so you orchestrate the build as a Workflow with parallel
sub-agents rather than serially.

GOAL: Build the shared accessibility interaction primitives and hang them off
HudContext, an input-mode gate (game-input vs UI-focus), a modal focus-trap /
inert / Escape-stack / focus-restore helper, a roving-tabindex utility, and an
announcer singleton with throttled and coalesced live regions (gated by a
Reader-Mode flag, off by default).

=====================================================================
STEP 0 - PRE-FLIGHT (do all of this before writing any code)
=====================================================================
0a. Clean git status. This is a SHARED worktree. Run `git status`. If it is
    dirty with files you did not create, STOP and ask the human before touching
    anything; never `git add -A` or revert another session's work.

0b. CROSS-PACKET CHECKPOINT (HARD GATE). This phase depends on the
    ui-architecture-hud-modularization refactor's HudContext seam (refactor
    Phase 11), per
    `docs/hud-ux-and-accessibility/state.md` (Cross-packet dependency section).
    Confirm BOTH of these exist before proceeding:
      - the directory `src/ui/hud/`
      - the HudContext seam file `src/ui/hud/hud_context.ts` (re-grep for the
        symbol `HudContext`, do NOT trust a path; the refactor may name the file
        differently, e.g. `context.ts` exporting `HudContext`. Grep:
        `grep -rn "HudContext" src/ui/`).
    If `src/ui/hud/` is absent OR no `HudContext` type/interface is exported
    anywhere under `src/ui/`, the refactor dependency is UNMET. STOP and report
    `failed: Phase 3 blocked, refactor HudContext seam (refactor Phase 11) not
    present; cannot hang a11y primitives off a seam that does not exist`. Do not
    invent the seam, do not stub HudContext yourself, do not proceed.

0c. MEMORY SCAN. Read `~/.claude/projects/-Users-fernando-Documents-world-of-claudecraft/memory/MEMORY.md`
    and the linked notes relevant here: hud, i18n, shared-worktree (stage only
    your files), never-push-to-fork (push branches/PRs to origin levy-street,
    never the FernandoX7 fork), no-em-dashes-or-emojis, live-site-and-test-creds
    (worldofclaudecraft.com, fernando/turbo564, window.__game debug hook for live
    driving). Obey all of them for the whole phase.

0d. BRANCH. Create the phase branch off the current up-to-date base:
    `git checkout -b feature/p3-a11y-interaction-foundation`. One card, one
    branch, one PR.

=====================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or hud.ts in the main loop)
=====================================================================
Spawn ONE Explore agent (read-only) and have it return a tight written summary.
Do NOT read these large files yourself in the main loop; do NOT read
`src/ui/hud.ts` (it is ~6k lines and not edited this phase). Tell the Explore
agent to summarize, with exact symbol names and current behavior:

  - `docs/hud-ux-and-accessibility/state.md`: locked decisions, the invariants
    list (by number), the validation matrix row for "A11y change", the
    review-dispatch matrix, the cross-packet dependency, the ledger entry that
    Phase 3 must fill (`src/ui/hud/a11y/` with input_mode.ts, focus_trap.ts,
    roving_tabindex.ts, announcer.ts, and `tests/a11y/*.test.ts`).
  - `docs/hud-ux-and-accessibility/research-brief.md` SECTION 3 (ARIA widget
    specs, especially the modal dialog #1, toolbar/roving-tabindex notes, and
    live-regions #8) and SECTION 4 (the real-time screen-reader and
    focus-management model: the one-announcer architecture, the throttle/coalesce
    policy, the two-mode `inputMode: 'game' | 'ui'` input model, the
    text-input-focus guard, `KeyboardEvent.code` movement, the modal
    focus-trap + inert + Escape-stack + focus-restore pattern, roving tabindex
    over aria-activedescendant and WHY mobile SRs force that choice). Pull all
    ARIA roles, the polite-vs-assertive split, and the coalescing/queue-cap facts
    from HERE, do not invent them.
  - `docs/hud-ux-and-accessibility/progress.md`: the Phase 3 deliverables and
    acceptance checklist (the source for STEP 5).
  - THIS phase prompt file
    (`docs/hud-ux-and-accessibility/phase-03-a11y-interaction-foundation.md`).
  - SOURCE FILES, summarized individually (re-grep for the named anchors, report
    the current line, do NOT trust line numbers below, they drift):
      * `src/game/input.ts`: the global keydown/keyup handler. Re-grep for the
        text-input guard (`tagName`, `isContentEditable`, the lowercased tag
        check) and for `KeyboardEvent.code` usage (`e.code`, `actionForCode`,
        the `this.keys` movement set, the `onUiKey('escape')` path, the emote
        wheel held-codes). Report exactly where movement keys enter `this.keys`,
        where Escape is dispatched, and where the existing input guard already
        bails on a focused text field. This is where the input-mode gate hooks.
      * `src/game/keybinds.ts`: re-grep for `actionForCode` and the movement /
        action binding map. Report how an `e.code` maps to a game action today.
      * `src/ui/hud/hud_context.ts` (or wherever `HudContext` is defined, found
        in 0b): report the exact shape of the seam, how modules obtain the
        context, what is already on it, and where a new field/helper would be
        added without breaking existing consumers.
  - Existing reuse: re-grep for the established `.visually-hidden` class and any
    current `aria-live` usage (`grep -rn "visually-hidden" src/ui/` and
    `grep -rn "aria-live\|role=\"status\"\|role=\"alert\"" src/ui/`) so the
    announcer reuses the existing hidden-text pattern rather than inventing a new
    one. Report the `t()` import path and signature, and the locale-overlay
    contributor policy (add keys to `en` only in `src/ui/i18n.en.ts`).

Give every later agent ONLY this Explore summary, not the raw docs.

=====================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
=====================================================================
Orchestrate as a Workflow with explicit fan-out. The three utilities are
independent surfaces; build them in parallel, then integrate. Each agent gets
ONLY the Explore summary. The new code lives under `src/ui/hud/a11y/`.

Request fan-out of these three implementation agents in parallel:

  AGENT A - input-mode gate + text-input guard + KeyboardEvent.code movement.
    Deliverables:
      - `src/ui/hud/a11y/input_mode.ts`: an explicit input-mode state, modeled
        as `inputMode: 'game' | 'ui'` per research-brief section 4 (cite it).
        Flipped by window open/close and focus events, NOT inferred per keypress.
        Expose it on HudContext (a field plus a setter/subscribe surface; match
        the seam's existing pattern from the Explore summary). Default is 'game'.
      - Hook the gate into `src/game/input.ts` so that in 'ui' mode the global
        movement/ability/number-hotkey handlers are suppressed (movement keys do
        not enter the movement set, 1-0 do not fire abilities), while native
        focus and Tab/Enter drive the UI. In 'game' mode behavior is byte-for-byte
        unchanged (this is the load-bearing safety requirement of invariant 6).
      - HARDEN the text-input guard at the TOP of the global keydown handler:
        bail if the focused element is `INPUT`/`TEXTAREA`/`isContentEditable`
        (the #1 WASD-web bug, research-brief section 4). The repo already has a
        guard near the tag/isContentEditable check, re-grep and confirm it covers
        all movement and hotkey paths; extend, do not duplicate.
      - Confirm movement binds on `KeyboardEvent.code` ("KeyW"), not `.key`, so
        WASD auto-maps to ZQSD on AZERTY (research-brief section 4). The repo
        already uses `e.code`; verify the gate preserves this and add a test that
        asserts it.
      - Tests in `tests/a11y/input_mode.test.ts`: in 'game' mode WASD enters the
        movement set and 1-0 fire; in 'ui' mode they do NOT; typing "w" while a
        text field is focused never moves the avatar (in either mode); Escape and
        Tab routing is correct per mode; `e.code` (not `e.key`) drives movement.

  AGENT B - modal focus-trap + inert background + Escape stack + focus restore
    + roving-tabindex utility. Deliverables:
      - `src/ui/hud/a11y/focus_trap.ts`: a helper that, given a modal root
        element, traps Tab (wrap forward at the last focusable, Shift+Tab wraps
        backward to the last), applies `inert` to the background so it blocks all
        interaction AND conveniently stops movement keys leaking, stores the
        opener and RESTORES focus to it on close, and participates in an
        Escape-stack (Escape closes the topmost trapped modal first; only with no
        modal open does Escape fall through to the game, coordinate with Agent A's
        Escape routing). Set `aria-modal="true"` + `role="dialog"` semantics on
        the modal root per research-brief section 3 #1. Prefer the native
        `<dialog>` affordances where the seam already uses them; the helper must
        also work for hand-built div windows (the brief notes both). Reserve
        modal/trap semantics for BLOCKING windows only; a pinned non-blocking
        window must NOT be trapped (invariant 6: traps apply only to modal UI).
        Flipping a modal open should set HudContext inputMode to 'ui' and restore
        the prior mode on close (coordinate field with Agent A).
      - `src/ui/hud/a11y/roving_tabindex.ts`: a reusable roving-tabindex utility
        for grids/lists/toolbars (exactly one element `tabindex="0"`, rest `-1`;
        arrows move and update the roving element; Home/End jump; Tab moves into
        and out of the whole group as one stop). Roving tabindex on REAL DOM
        elements, NOT aria-activedescendant (locked decision 4; mobile SRs ignore
        activedescendant, research-brief section 4). The utility is generic;
        applying it to specific windows is OUT OF SCOPE this phase.
      - Any accessible name the utilities surface (e.g. an "N of M" position cue,
        a default modal close label) is a `t()` key added to `en` only
        (`src/ui/i18n.en.ts`), per invariant 2 (see INVARIANTS below).
      - Tests in `tests/a11y/focus_trap.test.ts` and
        `tests/a11y/roving_tabindex.test.ts`: Tab wraps at both edges; background
        is `inert` while open and not after close; Escape pops the stack
        top-first and only falls through when empty; focus restores to the stored
        opener on close; roving keeps exactly one `tabindex="0"`, arrows move it,
        Home/End jump, the group is a single Tab stop. Add an axe assertion that a
        trapped modal has the required dialog role + name + `aria-modal`.

  AGENT C - announcer singleton + live-region infrastructure. Deliverables:
      - `src/ui/hud/a11y/announcer.ts`: a SINGLETON announcer that consumes
        HudContext and resolves all strings via `t()`. It owns a fixed set of
        pre-existing EMPTY live regions created in the DOM at startup (the region
        must exist before content is injected or the first message is silent,
        research-brief section 4). Channels per research-brief section 4 and the
        ARIA correction in section 3 #8: `role="status"` for ambient (do NOT also
        write `aria-live="polite"`, the role already implies polite + atomic, and
        the double-write double-speaks on iOS VoiceOver); `role="alert"` for
        critical interrupts (assertive is implied, again do not double-write);
        reuse the existing `.visually-hidden` pattern for the regions. Implement
        throttling/coalescing: buffer messages and flush on a ~500-1000ms
        interval (NOT per tick), REPLACE not append in the transient status region
        (single `textContent` assignment), wrap multi-node rebuilds in
        `aria-busy="true"` then `false`, and CAP the pending queue (~3 items,
        drop oldest). These thresholds are the brief's suggested defaults and are
        flagged OPEN there; expose them as named constants so QA/playtest can tune
        them.
      - GATING: the announcer is exposed on HudContext but INERT until a
        Reader-Mode flag is on; the flag defaults OFF. When off, the announcer
        does ZERO per-frame work and makes ZERO DOM writes (invariant 5). The
        live-region DOM scaffold may exist at startup but must carry no content
        and run no timers while Reader Mode is off; the flush interval/timer only
        runs while Reader Mode is on. Wiring announcements to actual game events
        (combat, target, cooldowns) is OUT OF SCOPE (Phase 19); the Reader-Mode
        TOGGLE UI is OUT OF SCOPE (Phase 21). This phase ships the mechanism and
        leaves it off and unwired.
      - Tests in `tests/a11y/announcer.test.ts`: with Reader Mode OFF, calling
        the announce API writes nothing to the DOM and starts no timer; with it
        ON, ambient goes to the status region and critical to the alert region;
        coalescing replaces (not appends) in the transient region; the queue caps
        at the configured size and drops oldest; the region is the implicit-polite
        role only (no redundant `aria-live`). Add an axe assertion on the
        live-region DOM scaffold.

After fan-out, integrate: a short main-loop pass that resolves the shared
HudContext field names the three agents touched (inputMode, the announcer handle,
the Reader-Mode flag) into one consistent seam edit, then run STEP 3. If two
agents edited the same HudContext lines, reconcile by hand; if they edited
disjoint files, just confirm the field names match.

=====================================================================
INVARIANTS THIS PHASE MUST KEEP (cited by number from state.md)
=====================================================================
- Invariant 6 (accessibility does not regress gameplay): the input-mode gate must
  NEVER swallow movement/hotkeys during normal play; focus traps apply ONLY to
  modal UI. In 'game' mode, input.ts behavior is unchanged. This is the primary
  correctness bar and a STOPPING RULE below.
- Invariant 2 (t()-only render sink): EVERY new aria-label, announcement string,
  default modal-close label, "N of M" cue, title, and any user-readable text the
  utilities emit is a `t()` key added to `en` first in `src/ui/i18n.en.ts`. Do
  NOT edit the locale overlays (the maintainer batch-fills at release). Numbers /
  percents in any value-text go through `formatNumber`/`Intl`, never
  concatenation. `tests/localization_fixes.test.ts` must stay green.
- Invariant 5 (per-frame budget): ZERO per-frame cost when Reader Mode is off. No
  timers, no DOM writes, no `getComputedStyle` on the hot path. Announcer writes
  happen on state change only, never per frame. The hot-write skip rate stays
  above ~0.8 (`tests/hud_perf_budget.test.ts`).
- Invariant 1 (IWorld-only): these are client-only UI utilities; do NOT add any
  `IWorld` member. If a utility seems to need one, that is a STOPPING RULE.
- NOTE on visuals: this packet deliberately changes visuals across the program,
  but THIS phase adds no visible chrome (the Reader-Mode toggle UI is Phase 21).
  If any incidental pixel drift appears, re-baseline Playwright snapshots ONLY
  after reviewing the diff (state.md locked decision 7). Do not blind-update.

=====================================================================
OUT OF SCOPE (do not do these here)
=====================================================================
- Applying roving tabindex to specific windows (action bar, bags, etc.) - those
  are the per-window passes (Phases 7, 9-18). Ship the utility, not the wiring.
- Wiring announcements to combat/target/cooldown/loot events - Phase 19.
- The Reader-Mode toggle UI in Options - Phase 21.
- Any token/visual restyle, theme, or text-scale work - Phases 1, 21.
- Any change to `src/sim/`, `server/`, `src/net/`, `IWorld`, or the admin SPA.

=====================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
=====================================================================
Run the state.md "A11y change" validation-matrix row exactly:

  3a. `npx tsc --noEmit`
  3b. The phase unit tests:
      `npx vitest run tests/a11y/input_mode.test.ts tests/a11y/focus_trap.test.ts tests/a11y/roving_tabindex.test.ts tests/a11y/announcer.test.ts`
  3c. The HUD harness + perf gate:
      `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts`
      (assert the hot-write skip rate stays above ~0.8 with Reader Mode off).
  3d. The i18n guard (new aria/announcer strings are `t()` keys):
      `npx vitest run tests/localization_fixes.test.ts`
  3e. The axe-core a11y assertions added this phase
      (`npx vitest run tests/a11y/*.test.ts` covers the axe checks on the modal
      and live-region scaffolds; if a Playwright a11y suite exists run
      `npx playwright test tests/a11y`).
  3f. Playwright MCP live-game walkthrough (needs `npm run dev`, often
      `npm run server`; use the live creds / `window.__game` hook only if you
      drive the live site). Verify, with the browser:
        - KEYBOARD-ONLY navigation works: open a modal window, Tab cycles within
          it and wraps, Shift+Tab wraps backward, focus is VISIBLE on every stop
          (`:focus-visible`), Escape closes the topmost modal and restores focus
          to the opener, and ONLY with no modal open does Escape reach the game.
        - The input-mode gate: with a modal/text field focused, typing WASD does
          NOT move the avatar; with no UI focused, WASD moves normally and 1-0
          fire abilities (invariant 6 proof).
        - Reader Mode is OFF by default and there is no per-frame announcer
          activity (no live-region content, no timer).
        - Switch the locale (use `supportedLanguages`, not a printed list): no
          English leak from any new label the utilities surface.
        - Toggling themes / text-scale / Reader Mode is NOT required to be wired
          this phase (those are Phases 21); just confirm nothing this phase added
          breaks the existing controls.
  3g. Deliberate visual re-baseline: run `npx playwright test`. This phase should
      cause NO intentional pixel change. If snapshots differ, REVIEW the diff
      before doing anything; only run `npx playwright test --update-snapshots`
      after you have inspected and justified each changed pixel. An unreviewed
      snapshot update is not allowed.

REVIEW DISPATCH (spawn ONLY agents whose surface the diff touches, per the
state.md review-dispatch matrix). This phase is client-only (`src/ui/hud/a11y/`,
`src/game/input.ts`, `src/game/keybinds.ts`, `src/ui/i18n.en.ts`, `tests/a11y/`):
  - SPAWN `qa-checklist` (always, when the deliverable set is complete).
  - Do NOT spawn `migration-safety` (no `server/*_db.ts` or `characters.state`).
  - Do NOT spawn `privacy-security-review` (no server/admin/net/secret/SQL/
    `ALLOW_DEV_COMMANDS` and no `Math.random`/`Date.now`/`performance.now` in
    `src/sim/`).
  - Do NOT spawn `cross-platform-sync` UNLESS the diff touched `IWorld`/sim/net
    (it must NOT; if it did, STOP, that is an invariant-1 violation).
  - For Opus 4.8: spawn ONE fresh subagent to review your own diff for
    correctness, ARIA-spec conformance (against research-brief section 3/4), and
    requirement gaps (not style), before declaring done.

Prompt every review/QA agent for COVERAGE, not filtering: "report every issue you
find, do not pre-filter by severity; I will triage." If an agent truncates,
resume it with: "Continue from where you stopped; do not restart; append only the
remaining findings." Do not commit until there are no BLOCKING findings.

=====================================================================
STEP 4 - COMMIT CADENCE (explicit paths only, never `git add -A`)
=====================================================================
Stage only this card's files. Suggested commits:
  1. feat(a11y): input-mode gate + text-input guard + code-based movement
     git add src/ui/hud/a11y/input_mode.ts src/game/input.ts src/game/keybinds.ts src/ui/hud/hud_context.ts tests/a11y/input_mode.test.ts
  2. feat(a11y): modal focus-trap, inert, Escape stack, focus restore
     git add src/ui/hud/a11y/focus_trap.ts tests/a11y/focus_trap.test.ts
  3. feat(a11y): roving-tabindex utility for grids, lists, toolbars
     git add src/ui/hud/a11y/roving_tabindex.ts tests/a11y/roving_tabindex.test.ts
  4. feat(a11y): announcer singleton + coalesced live regions, gated by Reader Mode
     git add src/ui/hud/a11y/announcer.ts src/ui/i18n.en.ts tests/a11y/announcer.test.ts
  5. docs(a11y): record Phase 3 ledger, progress, and memory notes
     git add docs/hud-ux-and-accessibility/progress.md docs/hud-ux-and-accessibility/state.md
(Adjust the exact paths to the real file names found in pre-flight, especially
the HudContext file. Push the branch to origin levy-street and open ONE PR; never
push to the fork.)

=====================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 3)
=====================================================================
[ ] Input-mode gate (game-input vs UI-focus) + text-input guard +
    KeyboardEvent.code movement; never swallows movement/hotkeys in normal play.
[ ] Shared modal helper: focus-trap, inert background, Escape stack, focus
    restore on close, hung off HudContext.
[ ] Roving-tabindex utility with t() labels (real DOM elements, not
    aria-activedescendant).
[ ] Announcer singleton + live-region infrastructure (status/polite ambient,
    alert/assertive critical, coalescing), gated by a Reader-Mode flag, OFF by
    default, zero per-frame cost when off.
[ ] tests/a11y/*.test.ts unit-cover each utility; axe assertions; harness + perf
    gate green; i18n guard + tsc green.

=====================================================================
STEP 6 - DOC UPDATES + MEMORY
=====================================================================
- `docs/hud-ux-and-accessibility/progress.md`: set Phase 3 status to complete with
  dates; check off the Phase 3 deliverables; add a Notes entry (the real file
  names created, the HudContext field names you added, the announcer's coalescing
  constants and where they live, anything left OPEN for QA/playtest tuning).
- `docs/hud-ux-and-accessibility/state.md`: update the ledger line "(Phase 3)
  src/ui/hud/a11y/ (input_mode.ts, focus_trap.ts, roving_tabindex.ts,
  announcer.ts), tests/a11y/*.test.ts" to reflect the actual files; record the new
  HudContext members (inputMode, announcer handle, Reader-Mode flag) and any new
  `t()` keys; note any OPEN item resolved or still open (coalescing interval,
  queue cap).
- Memory: add a hud/a11y note recording that the a11y interaction foundation
  landed under `src/ui/hud/a11y/`, the HudContext seam now carries inputMode +
  announcer + a Reader-Mode flag (off by default), and that wiring (Phase 19) and
  the toggle UI (Phase 21) are intentionally deferred.

=====================================================================
STEP 7 - FINAL RESPONSE FORMAT
=====================================================================
Return, concisely:
  - STATUS: complete / blocked / failed.
  - FILES TOUCHED: absolute paths, grouped by the four deliverables + docs.
  - VALIDATION RESULTS: tsc, the four a11y unit suites, harness + perf skip rate,
    i18n guard, axe assertions (pass/fail counts), and the Playwright result
    INCLUDING whether snapshots changed and whether you re-baselined after review.
  - REVIEW VERDICTS: qa-checklist verdict and the self-diff review verdict
    (BLOCKING / non-blocking, with what you fixed).
  - DEFERRALS: explicitly note that announcement wiring (Phase 19) and the
    Reader-Mode toggle UI (Phase 21) are out of scope and not done.
  - HANDOFF: a one-line handoff to the Phase 4 QA session.

=====================================================================
STOPPING RULES (stop and report; do not push through)
=====================================================================
- STOP if HudContext is not present (refactor dependency unmet, see 0b): report
  `failed:` with the reason. Do not stub the seam.
- STOP if the input-mode gate would intercept movement keys during NORMAL
  gameplay (game mode), i.e. if you cannot prove invariant 6 holds: report
  `failed:` and do not commit.
- STOP if any utility would require a new `IWorld` member (invariant 1): surface
  it, do not add the member.
- STOP and ask if `git status` is dirty with another session's files (shared
  worktree), or if a review surfaces a BLOCKING correctness/a11y-spec gap you
  cannot resolve within scope.
```
