# Phase 11 starter prompt: Extract IconService + define the HudContext seam (Card P1-C)

Paste the fenced block below into a fresh Claude Code session. It is
self-contained: it tells that session everything it needs to execute Phase 11
without reading this wrapper. Anchors (line numbers) drift; the prompt instructs
the runner to re-grep symbols, never trust a printed line number.

### Starter Prompt

```
This is Phase 11 of the UI Architecture and HUD Modularization feature: Extract
IconService + define the HudContext seam.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: This phase is NOT batch-heavy (two tightly-coupled slices, one new
service plus one shared type that the Hud constructs). You do NOT need to add the
keyword ultracode or orchestrate via a Workflow. Two parallel agents is the right
size. (Reserve ultracode for the batch-heavy P2 window phases.)

GOAL
Wrap procedural icon generation and caching behind a small IconService, and
define the shared HudContext service bag that every extracted window (Phase 13+)
will consume. No window is extracted in this phase.

STEP 0 - PRE-FLIGHT
1. Run `git status`. This checkout may be shared by a concurrent session. If the
   working tree is dirty with files that are not yours, STOP and ask the user how
   to proceed before touching anything. Do not stash or revert another session's
   work.
2. Create your branch off the current integration branch: one card, one branch,
   one PR. Use `feature/p1-c-iconservice-hudcontext`.
3. Scan Claude Code memory before starting: read MEMORY.md and the topic notes it
   indexes that are relevant here: the i18n resolved baseline note, the
   shared-worktree commit-care note, the never-push-to-fork note, and the
   no-em-dashes-or-emojis note. Honor all of them. In particular: stage only your
   card's files with explicit paths (never `git add -A`); push branches and PRs to
   origin (levy-street), never the FernandoX7 fork.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts directly in
the main loop; they are large and will burn your context)
Spawn ONE Explore agent. Tell it to read and return a tight summary (not full
dumps) of:
  - docs/ui-architecture-hud-modularization/state.md (locked decisions, the
    non-negotiable invariants, the validation matrix, the review-dispatch matrix,
    the anchors index, the ledger row for Phase 11, and the OPEN items)
  - docs/ui-architecture-hud-modularization/progress.md (ONLY the Phase 11
    deliverables/acceptance section and the status table row for Phase 11)
  - this Phase 11 starter prompt (the instructions you are reading)
  - src/ui/icons.ts: the exact exported signatures of iconDataUrl, iconCanvas,
    and QUALITY_COLOR, plus any module-level cache they already maintain (so the
    service wraps, not duplicates, existing caching). Report whether iconCanvas
    needs a real 2D canvas context (the OPEN item about happy-dom lacking canvas).
  - src/ui/hud.ts: ONLY the Hud constructor and its injected/helper fields. Have
    the agent re-grep `class Hud`, the constructor, and the helper fields rather
    than trusting any line number: the HotWriteGate / hot-write cache, the window
    manager, the tooltip helper, the money/format helper, the `sim` field and its
    declared type, the renderer-pick path, and the keybinds reference. The agent
    must report, for each, the exact field name and its TypeScript type as
    declared today.
  - src/world_api.ts: confirm `IWorld` is the type the Hud holds `sim` as (so
    HudContext can expose `sim: IWorld`, never `Sim`/`ClientWorld`).
Have it also report how the existing extracted primitives (Phase 7
src/ui/hud/hot_write_gate.ts, and if present Phase 9 src/ui/hud/reactive_diff.ts)
are constructed and threaded today, so the new HudContext threads the SAME single
gate instance by reference rather than constructing a second one.
No web-research agent is needed: this phase names no external surface (no
Playwright, no new dev dep; IconService wraps existing in-repo code).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request parallel fan-out of TWO agents. Give each ONLY the Explore summary from
Step 1, not the raw planning docs and not raw hud.ts.

  Agent A - IconService + its test.
    Deliverable: src/ui/hud/icon_service.ts, a small class wrapping iconDataUrl,
    iconCanvas, and QUALITY_COLOR from src/ui/icons.ts. It must preserve existing
    caching behavior byte-for-byte (if icons.ts already caches, the service reuses
    that cache; it must NOT introduce a second divergent cache). The service is a
    thin seam, not a rewrite of the icon generator. No new player-visible strings;
    no t() additions; no DOM-id changes.
    Deliverable: tests/icon_service.test.ts. Opt the file into a DOM env per-file
    only if iconCanvas genuinely needs a canvas 2D context (use
    `// @vitest-environment happy-dom`, or `jsdom` if happy-dom lacks the canvas
    API per the OPEN item; if so, record the resolution to feed back into
    state.md). Do NOT flip the global Vitest env. The test asserts: the service
    returns the same data URL / QUALITY_COLOR values as calling icons.ts directly,
    and that repeated calls hit the cache (no recompute).

  Agent B - HudContext type + Hud constructing and threading it.
    Deliverable: src/ui/hud/hud_context.ts. Define the shared service bag the
    extracted windows will consume. Its members, and ONLY these (each must already
    exist as an injected Hud field or be one of the extracted primitives), are:
      - the single HotWriteGate instance (threaded by reference, not reconstructed)
      - the window manager
      - the IconService instance (Agent A's class)
      - the tooltip helper
      - the money/format helper
      - sim: IWorld   (NEVER Sim or ClientWorld; this is the IWorld-only invariant)
      - the renderer-pick (the renderer-derived pick/worldToScreen path the Hud
        already holds)
      - keybinds
      - t   (the translation function reference)
    Deliverable: the Hud constructs ONE HudContext in its constructor and holds
    it, reusing the existing single gate / window manager / sim / keybinds / t
    references (do not duplicate any of them). This phase does NOT yet pass the
    context into any window (no window is extracted here); it only establishes and
    populates the seam so Phase 13+ can consume it. Keep every existing Hud field
    and behavior intact; the context is additive.

Coordinate the two: Agent B depends on Agent A's IconService export name, so give
Agent B the agreed class/constructor signature up front. If they edit the same
file in parallel (they should not; A owns icon_service.ts + its test, B owns
hud_context.ts + the Hud ctor), use worktree isolation; otherwise plain parallel
agents are fine.

INVARIANTS THIS PHASE MUST KEEP (from state.md; cite by number)
  - Invariant 1 (IWorld-only access): HudContext exposes `sim` as `IWorld`, never
    `Sim`/`ClientWorld`. If the context appears to need a member that is not on
    IWorld and is not one of the existing injected Hud helpers, that is a
    stop-and-surface design decision (see STOPPING RULES). Do NOT extend IWorld in
    this phase.
  - Invariant 4 (one shared hotWriteCache / HotWriteGate): the context carries
    EXACTLY ONE HotWriteGate instance, threaded by reference. Grep to prove no
    second cache is constructed.
  - Invariant 2 (t()-only render sink): no new strings; existing t() keys
    preserved verbatim. IconService and HudContext add zero player-visible copy.
  - Invariant 3 (DOM id/class contract): unchanged; this phase adds no DOM.
  - Invariant 8 (shared-worktree commit hygiene): stage only your files by
    explicit path; one card, one branch, one PR; push to origin not the fork.
  - Invariant 9 (no em dashes or emojis) in any code, comment, or doc you write.

OUT OF SCOPE (do not do these; prevent scope creep)
  - Do NOT extract any window. Spellbook is Phase 13; the other 9 are Phases 15-23.
    Defining HudContext is the seam those windows depend on; populating it is the
    whole job here.
  - Do NOT pass HudContext into a window or change any window code.
  - Do NOT rewrite the icon generator, change icon output, or alter QUALITY_COLOR
    values. IconService wraps; it does not redesign.
  - Do NOT add a new IWorld member, SimEvent, wire field, endpoint, table, or i18n
    key. None are expected this packet; any addition is a red flag.
  - Do NOT add a runtime dependency. A per-file DOM test env (happy-dom/jsdom) is a
    devDependency only if the icon test needs canvas.
  - Do NOT touch src/sim/, server/, src/net/, or src/admin/.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the exact validation for this change type (DOM/UI-logic plus build), from the
state.md matrix:
  - npx vitest run tests/icon_service.test.ts tests/hud_harness.test.ts
  - npx tsc --noEmit
  - npm run build
The hud_harness test must stay green (it really instantiates Hud, so it proves the
new HudContext construction did not break the constructor). If you opted the icon
test into a DOM env, confirm the ~150 pure sim tests still run on the node env
(global env unchanged). No player text changed and no matcher moved, so
tests/localization_fixes.test.ts is NOT required for this phase; run it only if
you unexpectedly touch a string.

Then dispatch review per the review-dispatch matrix. Check
`git diff --name-only` against your phase-start commit. This diff is pure
src/ui/ + tests/ (client-only, no server/net/admin/sim-behavior/IWorld change), so
spawn ONLY:
  - qa-checklist (the completion gate; every phase runs it)
Do NOT spawn privacy-security-review, migration-safety, or cross-platform-sync:
their surfaces (server, persistence, IWorld/wire/matchers/RL) are untouched here.
(If your diff somehow touches src/world_api.ts or a matcher, that is unexpected;
stop and reconsider, then add cross-platform-sync.)

Prompt the review agent for COVERAGE, not filtering: "Report every issue you find,
including low-severity and uncertain ones; ranking and triage are a later step. Do
not pre-filter." If the agent truncates, resume it with exactly: "Stop reading
more files. Output the full report now based on what you've already seen. No more
tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." Do not commit
final until qa-checklist reports no BLOCKING issues. As an Opus 4.8 self-verify
step, have a fresh subagent review your own diff for correctness and requirement
gaps (not style) before declaring done.

STEP 4 - COMMIT CADENCE (Conventional Commits, scope, explicit paths; NEVER
`git add -A`)
Suggested 3 commits (adjust to how the slices land, keep each self-contained):
  1. feat(ui): add IconService wrapping iconDataUrl/iconCanvas/QUALITY_COLOR
       git add src/ui/hud/icon_service.ts
  2. test(ui): cover IconService caching and parity with icons.ts
       git add tests/icon_service.test.ts
       (include vite.config.ts ONLY if you added a per-file DOM env note there;
        prefer the per-file pragma so no global config changes)
  3. feat(ui): define HudContext seam and construct it in Hud
       git add src/ui/hud/hud_context.ts src/ui/hud.ts
Commit the doc updates from Step 6 together with this work, explicit paths:
  4. docs(ui): record Phase 11 IconService + HudContext in progress/state
       git add docs/ui-architecture-hud-modularization/progress.md \
               docs/ui-architecture-hud-modularization/state.md

STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 11; all must be true)
  - [ ] src/ui/hud/icon_service.ts wraps iconDataUrl / iconCanvas / QUALITY_COLOR.
  - [ ] src/ui/hud/hud_context.ts defines the shared service bag: the single gate,
        window manager, IconService, tooltip helper, money helper, sim: IWorld,
        renderer-pick, keybinds, and t.
  - [ ] Hud constructs and threads HudContext (one context, reusing the existing
        single gate / window manager / sim / keybinds / t, no duplicates).
  - [ ] tests/icon_service.test.ts added and green; the HUD harness stays green.
  - [ ] npx tsc --noEmit and npm run build both green.
  - [ ] Exactly one HotWriteGate carried in the context (grep-proven, Invariant 4).
  - [ ] sim is typed IWorld in the context (Invariant 1); no IWorld member added.
  - [ ] No window extracted, no window code changed (Out of scope respected).

STEP 6 - DOC UPDATES + MEMORY
  - progress.md: set the Phase 11 status-table row to complete (with dates), and
    check off the Phase 11 deliverable boxes you satisfied. Note any deferral.
  - state.md: update "Current phase"; confirm the ledger row "(Phase 11)
    src/ui/hud/icon_service.ts, src/ui/hud/hud_context.ts, tests/icon_service.test.ts"
    matches what landed; if the icon test needed jsdom/happy-dom for a canvas
    context, record that resolution under OPEN items (it answers the canvas OPEN
    item). Note in the ledger that HudContext is now the seam Phase 13+ windows
    consume.
  - Memory: if anything was surprising (e.g. icons.ts caching shape, or the canvas
    env resolution, or the exact HudContext member set the windows will rely on),
    record a short note via the project's i18n/hud memory practice so the next
    session does not re-derive it.

STEP 7 - FINAL RESPONSE FORMAT (return exactly this shape)
  - Phase status: Phase 11 complete / blocked / needs-input (one word + reason).
  - Files touched: absolute paths, grouped new vs modified.
  - Validation results: the result of each command in Step 3 (pass/fail).
  - Review verdicts: qa-checklist verdict (BLOCKING/SHOULD-FIX/NICE-TO-HAVE) plus
    the self-verify subagent verdict.
  - Deferrals: anything punted (e.g. canvas env decision) with a one-line reason.
  - One-line handoff to the QA session (Phase 12): what to verify first.

STOPPING RULES (stop and surface to the user; do not improvise past these)
  - If HudContext would need a member that is NOT on IWorld and is NOT one of the
    existing injected Hud helpers (gate, window manager, IconService, tooltip,
    money helper, sim, renderer-pick, keybinds, t): STOP. That implies a missing
    seam, which is a design decision for the user, not a thing to invent. Report
    the exact member and why a window seems to need it.
  - If satisfying the context would require extending IWorld or adding any new
    IWorld member: STOP and surface (this packet expects none).
  - If the working tree is dirty with another session's files at Step 0: STOP and
    ask.
  - If npm run build pulls a new dependency into the game (main) bundle: STOP; the
    DOM env must be devDependency-only.
  - If you find yourself editing a window, src/sim/, server/, src/net/, or a
    matcher: STOP; that is out of scope for Phase 11.
```
