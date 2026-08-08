# Phase 8: The Harvest Journal and ready notices

The timer surface, shipped in-game before go-live: the OSRS lesson in D18, made
non-negotiable. This phase builds the Harvest Journal window (a DOM-free pure view core
plus a thin cold window and painter), map and minimap pins for the four patch sites, and
the ready notices from D14 (the login check plus the 1 Hz online sweep). Countdown
rendering copies the daily-rewards pattern wholesale. Everything here is actionable
information; none of it may ever be shed by a graphics tier knob.

Live-surface note (binding): After this phase merges, the Harvest Journal window opens
with honest empty states, the map and minimap pins mark the four patch sites, and the
ready notices (banner, chat line, farm_ready cue) fire only for dev-created crops until
go-live (Phase 9). No seeds are obtainable and no NPC or quest exists.

### Starter Prompt

```
This is Phase 8 of the Farming feature: The Harvest Journal and ready notices.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: the player always knows what is growing, where, and when it will be ready: the
Harvest Journal window with live honest countdowns, map and minimap pins for the four
patch sites, and the login and online ready notices.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Other sessions
  share the main checkout; never work there.
- git -C ~/Documents/woc-farming-plan status must be clean. Stop if it is not.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune; then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create
  branch fix/farming-phase-08-harvest-journal off its tip.
- Record the phase-start commit (git rev-parse HEAD) for the STEP 3 diff.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, and
  the phase-relevant topics: pr-screenshot-browser-path (this is a visual phase),
  pr2177-side-rail-split-review (the rail and the overlay click trap),
  frozen-clock-rig-hangs-vitest, i18n-semantic-regressions-gate-trap,
  big-diff-reviewer-turn-budgets, worktree-cwd-drift-misroutes-git.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thoroughness: very thorough) to read and summarize:
- docs/farming/state.md (whole file; D3, D14, D18, the seam reference on countdowns
  and notifications, and the wire section on the fplot key matter most) and
  docs/farming/progress.md (Phase 1 to 7 notes, deviations, name refinements).
- docs/farming/phase-08-harvest-journal.md (this phase file).
- Source files for this phase: the daily-rewards window modules (the countdown
  precedent: dedicated interval, data-attribute rebind, formatDateTime absolutes,
  the t() clock-token mm:ss template; Explore names the exact files), the
  UI_PURE_CORES allowlist in tests/architecture.test.ts, the map window view core
  and minimap markers modules (the map_window_view and minimap_markers patterns;
  Explore confirms exact paths), tests/hud_perf_budget.test.ts and its painter
  buckets, tests/crafting_launcher.test.ts (the rail-height budget guard),
  src/world_api/farming.ts and the fplot self delta key registration
  (ALL_DELTA_KEYS, TERSE_TO_IWORLD) as landed in Phase 2, the Phase 3 updateFarming
  driver in src/sim/professions/farming.ts, the Sim.addPlayer hook point (beside the
  mailWelcomed one-shot and the deeds retro block; summarize, the orchestrator never
  opens sim.ts), the banner queue and the gatherRareEvent hud case (the canonical
  text-free-event-to-localized-line shape), src/game/audio.ts (UI_CUES),
  scripts/sfx/sfx_prompts.mjs, and the S3 matcher seam in src/ui/sim_i18n.ts with
  tests/localization_fixes.test.ts.
- CLAUDE.md files: root, src/ui/CLAUDE.md, src/ui/hud/CLAUDE.md, src/styles/
  CLAUDE.md, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md.
The summary MUST return: (1) the daily-rewards countdown recipe, concretely enough
to copy (interval ownership, rebind attribute, the t() token pattern names); (2) the
cold-window contracts and which hud_perf_budget bucket a countdown window lands in;
(3) the exact shape the fplot projection carries today and whether it already
carries enough for an honest remaining-time under clock skew (a server-now anchor or
remaining seconds), plus the round-trip pin locations if it must widen; (4) the
professions-window entry point and keybind seams, and what the rail-height guard
permits; (5) the map and minimap pin recipes; (6) the addPlayer hook point and the
1 Hz sweep idiom (ctx.tickCount % 20, the guild_letter idiom); (7) the SimEvent
registration path and the S3 matcher recipe; (8) the SFX cue checklist; (9) any
Phase 1 to 7 deviation recorded in progress.md that touches this phase. The
orchestrator never reads planning docs or coordinator monoliths directly: work from
this summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request fan-out explicitly (this model under-spawns by default). Give each agent
ONLY the Explore summary plus its own slice. Never put a teammate agent in plan
mode. Default split, three agents by vertical slice, each owning its slice AND its
tests:

Agent A, the Harvest Journal window:
- src/ui/harvest_journal_view.ts (or the hud-domain directory form per
  src/ui/hud/CLAUDE.md; follow what Phases 1 to 7 established): a DOM-free pure
  view core registered in the UI_PURE_CORES allowlist. Rows: every plot with crop,
  stage, remaining time, and applied knobs (compost, watch, tonic). Honest
  empty-state copy for the no-plots and no-farming-skill cases.
- Remaining time derives from the wired fplot projection with clock skew handled
  per the state.md seam reference: the client renders server-anchored remaining
  time, never raw local wall clock against a server deadline.
- Time formatting through the t() clock-token pattern and formatDateTime, never a
  hand-built colon string.
- The thin window and painter honoring the cold-window contracts (no forced-reflow
  layout read, no repeating driver of its own), where the ONE sanctioned
  self-driver is the dedicated countdown interval with data-attribute rebind (the
  daily-rewards precedent). tests/hud_perf_budget.test.ts sorts every painter:
  land in the right bucket.
- The open-surface decision, made in-phase, with the side-rail capacity trap
  flagged EXPLICITLY: the rail is at capacity; prefer a professions-window entry
  point plus a keybind; check the rail-height budget guard in
  tests/crafting_launcher.test.ts BEFORE adding any rail button. Decide, state the
  choice, document it.
- English i18n rows for all window copy; the view-core suite.

Agent B, map presence:
- Map and minimap pins for the four patch sites, following the map_window_view and
  minimap_markers patterns the Explore summary names.
- English i18n rows for pin labels and tooltips; tests beside the patterns'
  existing suites.

Agent C, ready notices (sim, wire, and hud arms):
- The login check inside Sim.addPlayer immediately after saved state restore:
  state-derived, NO rng, a personal text-free farmReady SimEvent carrying ready
  counts, the flag-flip-before-emit idiom via the per-plot notified flag Phase 2
  LANDED in PlotState (default false, serialized with the rest; this phase only
  consumes it, so no save-shape change is expected; the flag persists, so relog
  never respams).
- The 1 Hz online sweep inside the Phase 3 updateFarming skeleton, emitting once
  per plot transition (ready and not yet notified: flip the flag, then emit).
- The hud arms: an ambient-class banner via the banner queue, a chat line, and a
  new farm_ready cue (UI_CUES key, facade method, hud case, prompt row, placeholder
  clip via npm run sfx:ui then sfx:manifest then sfx:check).
- S3 matcher coverage for the event's player-visible text
  (tests/localization_fixes.test.ts stays green) and English i18n rows.
- If honest countdowns need the fplot projection widened (remaining seconds or a
  server-now anchor), extend it WITH round-trip pins in the snapshots suites.
  The rule, stated literally: client UI code may use Date.now; src/sim/ may not,
  ever (wall clock only via ctx.lockoutNowMs).
- Determinism tests: the login check and sweep draw zero rng; a same-seed pin; a
  once-per-transition test driving real ticks across a ready boundary.

INVARIANTS THIS PHASE MUST KEEP
- The timer surface is actionable information: every element this phase ships (the
  journal rows, the countdowns, the map and minimap pins, the ready banner, the
  chat line) renders at every graphics tier and preset, and no tier knob may shed,
  hide, delay, or coarsen any of it. Only the cue audio follows the normal audio
  settings.
- i18n: every player-visible string added in this phase is a t() key added in
  ENGLISH ONLY to the matching src/ui/i18n.catalog/ module; all sim-side player
  text is a text-free id-carrying SimEvent re-localized client-side; the S3 guard
  covers every new emit in the SAME change.
- Determinism: all sim additions (the addPlayer check, the sweep, the notified
  flag) draw zero rng, and all randomness anywhere in src/sim/ stays on ctx.rng;
  no Date.now, Math.random, or performance.now enters src/sim/.
- Mobile: safe areas and comfortable tap targets on the window, its entry point,
  and the pins, verified with mobile screenshots.
- The seam: any IWorld or wire change lands in BOTH Sim and ClientWorld in the same
  change, with the parity pin in tests/world_api_parity.test.ts updated.

Out of scope (do NOT do in this phase):
- Vendor stock and seed availability (Phase 9).
- The intro quest and NPCs (Phase 9).
- Deeds (Phase 10).
- The golden_harvest rare event (Phase 10).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- npx tsc --noEmit
- npx vitest run <the view-core suite file>
- npx vitest run tests/hud_perf_budget.test.ts tests/crafting_launcher.test.ts
  tests/localization_fixes.test.ts tests/architecture.test.ts
- If the wire widened: npx vitest run tests/snapshots.test.ts
  tests/env_protocol.test.ts tests/bandwidth.test.ts
- npx vitest run tests/parity (BEFORE touching any golden; regen only deliberately)
- A mobile screenshot script against a phone viewport (per the validation matrix)
- npm run ci:changed
Then run git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows per the Review Dispatch Matrix in docs/farming/implementation-plan.md.
Expected matches here: frontend-seam-reviewer (ui, styles, game); cross-platform-
sync (a new SimEvent and possibly a widened wire key); architecture-reviewer (the
addPlayer hook and the sweep are sim changes); migration-safety ONLY if this phase
widens the fplot projection or otherwise moves the persisted shape (per its matrix
row; extend the round-trip pins in the same change); qa-checklist once the
deliverable set is complete. Every review agent gets a hard 30-tool-call budget,
the coverage instruction ("report every issue including low-severity and uncertain
ones; ranking happens later"), and, if truncated, the resume line: "Stop reading
more files.
Output the full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a BLOCKING
stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits with scopes and bodies, EXPLICIT paths, never git add
-A, no session links or Claude attribution. Suggested cut:
1. feat(sim): farmReady notices, the Phase 2 notified flag consumed, sweep, and (if
   widened) the fplot projection with pins.
2. feat(ui): harvest journal view core, window, painter, countdown driver, entry
   point.
3. feat(ui): map and minimap pins for the patch sites.
4. feat(game): farm_ready cue wiring.
5. docs(farming): progress and state ledger updates, screenshots.

STEP 5 - ACCEPTANCE CRITERIA
- [ ] The view core is DOM-free, registered in UI_PURE_CORES, and its Node suite
      covers rows, knobs, empty states, and remaining-time derivation.
- [ ] Remaining time is honest under clock skew: a deliberately skewed client clock
      still renders correct countdowns (server-anchored, not local-wall-clock).
- [ ] All time formatting goes through the t() clock-token pattern and
      formatDateTime; no hand-built colon strings anywhere in the diff.
- [ ] The window honors the cold-window contracts, its one self-driver is the
      countdown interval with data-attribute rebind, and
      tests/hud_perf_budget.test.ts sorts it into the correct bucket.
- [ ] The open-surface decision is made, stated, and documented; if a rail button
      was added, tests/crafting_launcher.test.ts still passes.
- [ ] Map and minimap pins mark all four patch sites.
- [ ] The login check emits one farmReady after saved state restore for ready
      unnotified plots, draws zero rng, and flips the flag before the emit.
- [ ] The 1 Hz sweep emits exactly once per plot transition; a real-tick test
      proves no repeat emit across subsequent ticks and across relog.
- [ ] The hud arms work: ambient banner, chat line, farm_ready cue; the cue row is
      marked PLACEHOLDER; sfx:check passes.
- [ ] Every new player-visible string is an English t() key; S3
      (tests/localization_fixes.test.ts) passes.
- [ ] If the wire widened: both worlds implement it, the parity pin is updated, and
      the snapshots suites pass with new round-trip pins.
- [ ] tsc, the view-core suite, the named suites, ci:changed, and gate_select are
      green (armory browser exception aside).
- [ ] Before/after screenshots (desktop and mobile) are committed under
      docs/screenshots.

STEP 6 - DOC UPDATES + MEMORY
- Update docs/farming/progress.md: the Phase 8 status row, the acceptance list
  above copied with its check states, and a Notes block (surprises, deviations,
  deferrals with reasons).
- Update the docs/farming/state.md ledgers: the farmReady SimEvent, any new wire
  key, new i18n keys and matcher rows, the open-surface decision.
- Any deviation decided in-phase gets swept into
  docs/farming/phase-08-harvest-journal.md AND docs/farming/phase-08-qa.md in the
  same pass.
- Record surprises (skew handling, rail findings, bucket surprises) in Claude Code
  memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status; files touched; validation results (each command, pass or
fail); review verdicts per agent; deferrals; and a one-line handoff for the Phase 8
QA session.

STOPPING RULES
- Stop if the countdown cannot be made honest under clock skew without widening the
  wire: widening is the sanctioned path, but stop FIRST if the widening is
  contentious (payload growth on a hot key, a shape change to an existing field)
  and surface the options before proceeding.
- Stop if the rail-height guard fails and no non-rail entry point is workable:
  surface it rather than loosening the guard.
- Stop if git status is dirty at session start or the release tip cannot be
  resolved.
- Stop if a review BLOCKING cannot be fixed without out-of-scope changes.

Close: gate via node scripts/gate_select.mjs (the armory browser red is the
standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; PR CI is the
arbiter), push, and open the PR against the release branch this phase was based on
per .github/PULL_REQUEST_TEMPLATE.md, with before/after screenshots (desktop and
mobile) captured via the pr-screenshots skill, committed under docs/screenshots,
and referenced from the PR body (this is a visual phase).
```
