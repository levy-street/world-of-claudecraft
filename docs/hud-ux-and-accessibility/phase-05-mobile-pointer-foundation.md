# Phase 05 starter prompt: Mobile + pointer foundation

Paste the fenced block below into a fresh Claude Code session. It is self-contained.

### Starter Prompt

```
This is Phase 5 of the HUD Visual + UX + Accessibility feature: Mobile + pointer foundation.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase touches several surfaces (the viewport meta, many edge-anchored HUD
elements across CSS, the canvas touch-look path, and a new pointer utility consumed nowhere yet).
If you find the edge-anchored-element audit fans out wider than a handful of files, add `ultracode`
and orchestrate the two agents (A, B) plus the safe-area audit via a Workflow so the batch stays
coherent; otherwise plain fan-out is fine.

GOAL: Remove the viewport scale lock AND relax the page-level touch-action that blocks page zoom (a
paired change - the meta unblock alone does not restore HUD pinch-zoom), apply safe-area insets to every
edge-anchored HUD element, apply target-size tokens, and provide single-pointer alternatives for drags
plus restore pinch-zoom over the HUD while keeping touch-action:none on the game canvas, satisfying WCAG
1.4.4, 1.4.10, 2.5.7, 2.5.1, and 2.5.8.

------------------------------------------------------------------------
STEP 0 - PRE-FLIGHT (do this before anything else)
------------------------------------------------------------------------
1. Git status: run `git status`. This is a SHARED worktree with concurrent sessions. If the tree
   is dirty with files you do not own, STOP and ask before touching anything. Only ever stage this
   card's files with explicit paths; never `git add -A`.
2. CROSS-PACKET CHECKPOINT (per docs/hud-ux-and-accessibility/state.md "Cross-packet dependency"):
   Phase 5 can START EARLY - it has NO modular-seam dependency (markup/CSS only; no HudContext).
   Confirm that statement still holds in state.md. If state.md now lists a refactor checkpoint that
   Phase 5 requires and it is NOT landed, STOP and surface. Do not invent a dependency that is not there.
3. Memory scan: read ~/.claude .../memory/MEMORY.md and the notes for topics: hud, i18n,
   shared-worktree, never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds. Honor them
   (push only to origin levy-street never the fork; no em dashes or emojis anywhere; test creds and
   the window.__game live hook are in live-site-and-test-creds).
4. Create the phase branch off the up-to-date base: `feature/phase-05-mobile-pointer-foundation`
   (one card, one branch, one PR).

------------------------------------------------------------------------
STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts in the main loop)
------------------------------------------------------------------------
Spawn ONE Explore agent. Tell it to read and return a tight summary of:
  - docs/hud-ux-and-accessibility/state.md (locked decisions, the 8 invariants by number, the
    validation matrix, the review-dispatch matrix, the cross-packet section, the Key file paths and
    the ledger).
  - docs/hud-ux-and-accessibility/research-brief.md SECTION 6 ONLY ("Mobile / touch UX and
    accessibility"): the verified viewport gap, the target-size tiers (24x24 AA floor with the
    20x20 + >=4px spacing exception; 48px primary touch hit area via padding not icon shrink; >=44px
    rows under PHONE_TOUCH_QUERY; >=8px between adjacent controls), the safe-area facts
    (viewport-fit=cover already present; pair with env(safe-area-inset-*) everywhere fixed UI touches
    an edge; apply unconditionally with a max(fallback, env(...)) second arg), the gesture facts
    (WCAG 2.5.1 pinch-camera needs zoom +/- buttons; WCAG 2.5.7 drags need tap-to-pick-then-place /
    "Move to..." / pan-recenter / tap-on-track alternatives; the ~10px move-before-drag threshold;
    touch_peek long-press disambiguation already exists).
  - docs/hud-ux-and-accessibility/progress.md, the "Phase 5 - Mobile + pointer foundation" block only.
  - This phase starter prompt (this file).
  - These SPECIFIC source files (read them individually, do not crawl):
      * index.html (the <meta name="viewport"> tag, line 5: it currently ships
        `maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover` - re-grep
        `user-scalable` to confirm, do not trust the line number).
      * src/game/mobile_controls.ts (the canvas touch-look + pinch-to-zoom path: re-grep the symbols
        `PHONE_TOUCH_QUERY`, `pinchPointers`, `currentPinchDist`, `zoomBy`, `touch-action`,
        `safe-area-inset`, and the `game-canvas` lookup - report which elements bind the touch/pointer
        listeners and which already use env(safe-area-inset-*)).
      * The mobile/touch CSS: re-grep for `PHONE_TOUCH_QUERY` usage, `@media` coarse-pointer blocks,
        `position: fixed`/`absolute` edge-anchored HUD rules (top/right/bottom/left: 0 or small px),
        `touch-action`, and any existing `env(safe-area-inset` usage, across index.html inline styles,
        the HUD stylesheet(s), and src/game/mobile_controls.ts injected styles. Return the full LIST
        of edge-anchored elements (unit/target/party frames, minimap, chat, action bar, joysticks,
        menu/bag toggles, modals, toasts) with the file:selector for each.
      * src/ui/touch_peek.ts (the existing long-press vs tap disambiguation; do not change its
        behavior, just understand the hold-threshold constant and the synthetic-click swallow).
  - Re-grep for any other element that anchors to a viewport edge so the safe-area audit is COMPLETE.
Give the agent ONLY the instruction to summarize; it edits nothing. The main loop and agents B/C work
from its summary, not from re-reading these docs.

------------------------------------------------------------------------
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
------------------------------------------------------------------------
Fan out TWO implementation agents (request fan-out explicitly; each gets ONLY the Explore summary).
If under ultracode, wrap them plus the safe-area audit in a Workflow.

AGENT A - viewport unblock + safe-area audit:
  Deliverables:
  1. In index.html, REMOVE `maximum-scale=1.0, minimum-scale=1.0, user-scalable=no` from the viewport
     meta (re-grep `user-scalable`); KEEP `width=device-width, initial-scale=1.0, viewport-fit=cover`.
     This restores browser pinch-zoom (WCAG 1.4.4 resize text, 1.4.10 reflow).
  2. Restore HUD/page pinch-zoom AND keep the canvas camera gestures working. These are TWO PAIRED
     changes; the viewport meta unblock in #1 is necessary but NOT sufficient on its own. Removing
     `user-scalable=no` alone does NOT restore page pinch-zoom over the HUD: the actual blocker is the
     CSS `touch-action: none` applied at the PAGE level. So you must ALSO relax `touch-action: none` on
     the page-level selectors while KEEPING it on the canvas:
       a. RELAX (drop `touch-action: none`, or set `touch-action: auto`/`manipulation`) on the
          page-level rules `body.game-active` and `body.mobile-touch #ui` (`#ui` is the full-screen HUD
          overlay). Re-grep `touch-action` to find these (the validation report cites `index.html:220`
          for `body.game-active` and `index.html:3829` for `body.mobile-touch #ui`; do not trust the
          line numbers, match the selectors). This is what lets browser pinch-zoom reach the HUD/menus.
       b. KEEP `touch-action: none` on `#game-canvas` (the validation report cites `index.html:3828`)
          so the in-game camera drag-look + the existing two-finger camera pinch still work and do not
          conflict with page zoom. The canvas owns its gestures; the page/HUD does not.
     Do NOT set a global page `touch-action: none` that re-disables zoom. The camera-pinch listeners in
     mobile_controls.ts are already scoped to the canvas/joystick zones, so the canvas keeping
     `touch-action: none` is correct; verify and keep that scoping. Note: the prior framing that "pinch
     already falls through to the page" was WRONG about current behavior - the page-level
     `touch-action: none` rules are what kill it, which is exactly why this relaxation is required.
  3. Audit EVERY edge-anchored fixed/absolute HUD element from the Explore list and apply
     `env(safe-area-inset-*)` with a fallback, unconditionally, using the
     `max(<existing px>, env(safe-area-inset-<edge>))` pattern (insets are 0 on non-notched devices, so
     this is safe everywhere). Cover bottom home-indicator overlap (action bar, joysticks), the
     notch/Dynamic Island and rounded corners (unit/target/party frames, minimap, chat, toasts), and
     any modal that does not already use it (one modal already does - re-grep `safe-area-inset` to find it).
  Constraints: no aesthetic restyle; structural ids/classes stay stable (invariant 3). Touch nothing
  outside index.html, the mobile/HUD CSS, and src/game/mobile_controls.ts.

AGENT B - target-size tokens + single-pointer drag utility:
  Deliverables:
  1. Add target-size design tokens (CSS custom properties; if Phase 1 token block has landed, slot
     them in its semantic layer, else define a small self-contained block these phases can later fold
     in - check state.md ledger for the token file): a 24px AA-floor target token, a larger primary
     touch-control token (48px hit area, expanded via PADDING not by shrinking the procedural icon),
     and an >=8px adjacent-spacing token. Apply >=44px row/cell sizing under `PHONE_TOUCH_QUERY` to
     desktop-density controls that also render on touch; use the 20x20 + >=4px spacing exception ONLY
     for genuinely dense grids (leave specific dense bag/auction grids to the per-window passes - do
     not retrofit them here). This sits above the repo's existing >=40x40 mandate.
  2. Create src/ui/hud/a11y/pointer.ts: a reusable single-pointer drag-alternative UTILITY so no HUD
     drag or zoom requires a path-based or multi-point gesture (WCAG 2.5.7 dragging, 2.5.1 pointer
     gestures, 2.5.8 target size). Provide the primitives the per-window passes will consume:
     tap-to-pick-then-tap-to-place (pick/place state machine + cancel), a "Move to..." style
     single-pointer reposition hook, zoom +/- button handlers that call the SAME zoom path as the
     pinch (so the camera pinch gains a single-pointer alternative), and a ~10px move-before-drag
     threshold helper so tremor does not trigger accidental drags. Keep src/ui/touch_peek.ts's
     long-press behavior intact; expose its hold threshold as a named constant if not already, but do
     not change normal-play behavior.
  3. Wire the zoom +/- buttons' single-pointer alternative to the existing camera-zoom path so pinch
     is no longer the only way to zoom the camera. Do NOT yet apply the pick/place util to any specific
     window (those are per-window passes).
  Constraints: pointer.ts has zero DOM-framework deps; every new aria-label/title/announcement string
  is a t() key in src/ui/i18n.en.ts (do not edit the locale overlays). Unit-test the utility.

Each agent returns: files touched (explicit paths), the WCAG criterion each change satisfies, any
element it could not safely fix and why, and a note if it hit a stopping rule below.

------------------------------------------------------------------------
INVARIANTS THIS PHASE MUST KEEP (cited by number from state.md)
------------------------------------------------------------------------
- Invariant 3 (DOM id/class contract): the ~214 structural ids index.html/CSS depend on stay stable.
  Mobile fixes go through tokens/classes/attributes, NOT by renaming ids.
- Invariant 2 (t()-only render sink): every new aria-label, title, button label, and announcement
  (zoom +/-, "Move to...", pick/place hints) is a t() key present for `en`; the i18n guard
  (tests/localization_fixes.test.ts) and tsc must stay green. Do not edit the non-English overlays.
- Invariant 8 (no em dashes or emojis) in any doc, comment, or player-facing string.
- Mobile safe areas: env(safe-area-inset-*) on every edge-anchored fixed element, applied
  unconditionally with a max(fallback, env(...)) second arg.
- WCAG criteria in play: 1.4.4 (resize text) and 1.4.10 (reflow) via removing the scale lock; 2.5.7
  (dragging movements) and 2.5.1 (pointer gestures) via the single-pointer utility + zoom buttons;
  2.5.8 (target size minimum) via the target-size tokens (24px AA floor, 48px primary, 20x20 + >=4px
  exception only where deliberate).
- This packet DELIBERATELY changes visuals/layout: any moved edge element is an INTENTIONAL baseline
  change. Re-baseline Playwright snapshots only after reviewing the diff (see STEP 3). Invariant 1
  (IWorld) and 4/5 (determinism, per-frame budget) are not in play here (no sim, no per-frame hot path
  touched); if you find yourself needing an IWorld member, STOP and surface (none is expected).

------------------------------------------------------------------------
OUT OF SCOPE (do not do these here)
------------------------------------------------------------------------
- Restyling any window to the dark-fantasy aesthetic (that is the per-surface / per-window passes).
- Applying the single-pointer drag utility to a SPECIFIC window's slots/items (action bar, bags,
  trade, etc.) - the per-window passes consume the utility; this phase only ships it.
- The left/right-handed mirror toggle, iOS Dynamic Type font hook, and Reader Mode wiring (later phases).
- Any change to src/sim/, server/, src/net/, src/admin/, or IWorld.

------------------------------------------------------------------------
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
------------------------------------------------------------------------
Run the state.md validation matrix for a Visual/token change PLUS the A11y-change additions:
  1. `npx tsc --noEmit`
  2. `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts` (harness + skip-rate gate).
  3. `npx vitest run tests/localization_fixes.test.ts` (new labels are t() keys - the i18n S3 guard).
  4. `npx vitest run` on the new pointer utility test and any tests/a11y/*.test.ts you added.
  5. axe-core a11y assertions: `npx vitest run tests/a11y/*.test.ts` and/or `npx playwright test tests/a11y`.
     Assert no target-size or name/role/value violations on the touched surfaces at a phone viewport.
  6. `npx playwright test` then, ONLY after you open and REVIEW the visual diff and confirm every change
     is the intended safe-area/target-size shift (no accidental regression), re-baseline deliberately with
     `npx playwright test --update-snapshots`. An UNREVIEWED snapshot update is not allowed.
  7. The mobile screenshot script at a PHONE viewport (the scripts/*.mjs mobile screenshot driver; needs
     `npm run dev`, and `npm run server` if the script logs in). Confirm no element is clipped by a notch
     or home indicator and nothing is pushed off-screen.
  8. Playwright MCP live-game walkthrough (creds + the window.__game hook are in the
     live-site-and-test-creds memory note): at a phone viewport,
       - switch the locale and confirm NO English leak in any new label/button/announcement;
       - verify browser pinch-zoom now works over the HUD/menus AND the in-game canvas touch-look +
         two-finger camera pinch still work (the touch-action scoping must not let them fight);
       - exercise the zoom +/- buttons (single-pointer camera zoom alternative);
       - keyboard-only nav reaches the new buttons with a visible focus ring;
       - confirm edge elements sit inside the safe area.

REVIEW-DISPATCH (spawn ONLY agents whose surface the diff touches; this is a client-only packet):
  - This phase is index.html + mobile/HUD CSS + src/game/mobile_controls.ts + src/ui/hud/a11y/pointer.ts
    + tests. That is `qa-checklist` ONLY.
  - Do NOT spawn privacy-security-review / migration-safety (no server/, src/admin/, src/net/, SQL,
    auth, secrets, or characters.state touched).
  - Do NOT spawn cross-platform-sync (no src/world_api.ts / src/sim/ / src/net/online.ts /
    server/game.ts wire / matchers / RL surface touched). If you somehow needed any of these, STOP.
  - For Opus 4.8: also have a FRESH subagent review your own diff for correctness, WCAG-spec
    conformance (1.4.4/1.4.10/2.5.7/2.5.1/2.5.8), and requirement gaps - not style.
Prompt every review/QA agent for COVERAGE, not filtering: report ALL findings at every severity, do not
pre-judge what is "worth" mentioning. If an agent truncates, resume it with: "Continue exactly where you
left off; do not restart; emit only the remaining items." Do not commit while any BLOCKING finding stands.

------------------------------------------------------------------------
STEP 4 - COMMIT CADENCE (explicit paths only; never git add -A)
------------------------------------------------------------------------
2 to 5 commits, Conventional Commits with a scope, for example:
  - a11y(ui): restore browser pinch-zoom and scope touch-action to the game canvas (index.html, src/game/mobile_controls.ts)
  - style(ui): apply env(safe-area-inset-*) to every edge-anchored HUD element (<the CSS/markup paths>)
  - feat(a11y): add target-size tokens (24px AA, 48px primary touch, 8px spacing) (<token file path>)
  - feat(a11y): add single-pointer drag/zoom alternative utility + tests (src/ui/hud/a11y/pointer.ts, tests/a11y/pointer.test.ts)
  - docs(ui): record Phase 5 progress, ledger, and memory notes (docs/hud-ux-and-accessibility/*.md)

------------------------------------------------------------------------
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md "Phase 5")
------------------------------------------------------------------------
- [ ] index.html viewport scale lock (user-scalable=no, maximum/minimum-scale) removed AND the
      page-level `touch-action: none` relaxed on `body.game-active` and `body.mobile-touch #ui` (these
      two changes are paired - the meta unblock alone does not restore page pinch-zoom); browser
      pinch-zoom restored over the HUD/menus (WCAG 1.4.4 / 1.4.10) without breaking canvas touch-look or
      the two-finger camera pinch (`touch-action: none` KEPT on `#game-canvas`).
- [ ] env(safe-area-inset-*) applied (with max() fallback) to EVERY edge-anchored HUD element.
- [ ] Target-size tokens applied: 24px AA floor, larger (48px) for primary touch controls,
      >=8px spacing; >=44px rows under PHONE_TOUCH_QUERY where applicable.
- [ ] Single-pointer alternative utility for drags and pinch-zoom shipped (WCAG 2.5.7 / 2.5.1 / 2.5.8);
      zoom +/- buttons wired to the camera-zoom path.
- [ ] Mobile screenshot script passes at a phone viewport; HUD harness + perf skip-rate gate green;
      tsc + i18n guard + axe assertions green; visuals re-baselined with a reviewed diff.

------------------------------------------------------------------------
STEP 6 - DOC UPDATES + MEMORY
------------------------------------------------------------------------
- progress.md: check off the Phase 5 boxes you completed; note anything deferred.
- state.md ledger: under "Created by this packet (Phase 5)" record the actual created/edited paths
  (the viewport/safe-area edits, src/ui/hud/a11y/pointer.ts, the target-size tokens added and their
  file, any tests/a11y file). Add new t() keys and any new gotcha (especially the touch-action scoping
  decision) to the OPEN items / gotchas if relevant.
- Memory: add a hud/i18n note capturing the touch-action scoping fix (canvas owns gestures, page keeps
  pinch-zoom) and the target-size token names so later phases reuse them.

------------------------------------------------------------------------
STEP 7 - FINAL RESPONSE FORMAT
------------------------------------------------------------------------
Report, concisely:
  - Status (done / blocked / partial).
  - Files touched (absolute paths).
  - Validation results: tsc, harness, perf skip-rate, i18n guard, axe assertions (pass/fail with the
    surfaces checked), the mobile screenshot result, and the visual re-baseline (which snapshots changed
    and that you reviewed the diff).
  - Review verdicts: qa-checklist + the fresh diff-review subagent (BLOCKING/non-blocking counts).
  - Deferrals (anything left to per-window passes or later phases).
  - One-line handoff to the QA phase (Phase 6).

------------------------------------------------------------------------
STOPPING RULES
------------------------------------------------------------------------
- STOP and resolve (do NOT ship a half-fix): if removing user-scalable=no makes the in-game touch-look
  camera conflict with browser pinch-zoom. The correct fix is the PAIRED change - relax the page-level
  `touch-action: none` on `body.game-active` and `body.mobile-touch #ui` so the HUD/page can zoom, while
  KEEPING `touch-action: none` on `#game-canvas` so the canvas owns its gestures. Removing
  user-scalable=no alone does NOT restore HUD pinch-zoom; the page-level `touch-action: none` rules are
  the real blocker. Implement BOTH halves and DOCUMENT the scoping decision; do not leave page-zoom
  re-disabled to "fix" the conflict, and do not assume the meta change alone is enough.
- STOP if a single-pointer alternative would change a game-input behavior in normal play (for example a
  zoom button or pick/place that alters WASD/hotkey/touch-look behavior when accessibility is off).
  Surface it; do not regress normal play (invariant 6).
- STOP and ask if the pre-flight git status is dirty with files you do not own.
- STOP and surface if Phase 5 turns out to need an IWorld member or any src/sim/ / server / net change
  (none is expected; it is a red flag per state.md).
- STOP if the cross-packet section in state.md now lists a refactor checkpoint Phase 5 requires that has
  not landed.
```
