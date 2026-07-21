# Phase 19 (impl): Reader Mode

Self-contained starter prompt. Paste the fenced block below into a fresh Claude
Code session. It references the packet docs by path and tells the runner to
re-grep named anchors rather than trust line numbers.

### Starter Prompt

```
This is Phase 19 of the HUD Visual + UX + Accessibility feature: Reader Mode.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (it wires many event types across many
already-instrumented surfaces and audits every menu for screen-reader navigation).
Add ultracode so you orchestrate the three workstreams as a Workflow with explicit
fan-out, rather than editing surface-by-surface in the main loop.

GOAL (one sentence): ship the opt-in Reader Mode by wiring the Phase 3 announcer
to target, HP, cast, cooldown, and loot events with coalescing and throttling,
adding combat assists (soft-target, directional earcons via the existing
WebAudio, click-to-move and click-cast confirmation), and making every menu fully
screen-reader navigable, while being honest that reflex-gated real-time combat is
not parity-accessible.

================================================================================
STEP 0 - PRE-FLIGHT (do all of this before any edit)
================================================================================
1. Clean git status. This is a SHARED worktree. Run `git status`. If it is dirty
   with files that are not yours, STOP and ask the user before touching anything.
   Never `git add -A`; stage only this card's files by explicit path.
2. CROSS-PACKET checkpoint (REQUIRED; see docs/hud-ux-and-accessibility/state.md
   "Cross-packet dependency"). Phase 19 needs: the Phase 3 a11y foundation landed
   (the announcer singleton + live regions on the HudContext seam,
   src/ui/hud/a11y/announcer.ts), AND the windows instrumented (Phases 7 and 9-18:
   roles/labels/roving-tabindex/focus-traps present on the chrome and the 10
   windows). Confirm by re-grepping for the announcer module and for instrumented
   window roles; do not trust line numbers. If the announcer does not exist or the
   windows are not yet instrumented, STOP and surface the gap; do not build the
   announcer from scratch here.
3. Memory scan. Read /Users/fernando/.claude/projects/-Users-fernando-Documents-
   world-of-claudecraft/memory/MEMORY.md and the notes it indexes for these topics:
   hud, i18n, shared-worktree, never-push-to-fork, no-em-dashes-or-emojis,
   live-site-and-test-creds. Honor all of them (push branches/PRs to origin
   levy-street, never the fork; no em dashes or emojis anywhere; use the live-site
   creds only for the Playwright walkthrough).
4. Create the phase branch: `feature/phase-19-reader-mode` off the current base.
   One card, one branch, one PR.

================================================================================
STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts directly)
================================================================================
Spawn ONE Explore agent. Tell it to read and return a tight summary of:
- docs/hud-ux-and-accessibility/state.md (locked decisions, the invariants by
  number, the validation matrix, the review-dispatch matrix, the ledger, the
  cross-packet dependency section).
- docs/hud-ux-and-accessibility/research-brief.md SECTION 4 in full (the real-time
  screen-reader and focus-management model): the live-region architecture (one
  announcer, the role="log"/status/alert channels, aria-atomic on the status
  region, aria-relevant="additions removals" on the buff/debuff region); the
  throttling-and-coalescing rules (decouple from the frame loop, flush on a
  ~500-1000ms interval not per tick, summarize rather than enumerate, replace not
  append in transient status regions, wrap multi-node rebuilds in aria-busy, cap
  the pending queue at ~3 and drop oldest); the per-surface announcement plan
  (target frame status+atomic on change with enemy TYPE as the highest-value
  combat announcement; player HP/resource only on threshold crossings; cast bar
  status on start and alert on interrupt, never the fill; cooldowns coalesced and
  user-selected only; buffs/debuffs additions+removals; loot/quest status with
  optional rarity earcons); the verbosity-tier model (combat summary/off, loot
  rarity-only/full); and the REALISTIC CEILING wording (menus + turn-based surfaces
  fully accessible; targeting/looting/casting/status/slower combat accessible via
  coalescing + assists; reflex-gated mechanics NOT parity-accessible, mitigate with
  assists, do not promise parity). Also pull the assists guidance: soft/auto-target
  (WoW Dragonflight Soft Targeting) and directional/HP earcons via procedural
  WebAudio (the BlindSlash precedent).
- research-brief.md SECTION 7 click-to-move and click-cast facts (WoW Click to
  Move; native Click Casting / mouseover casting added in Dragonflight) for the
  confirmation-path design only.
- docs/hud-ux-and-accessibility/progress.md, the Phase 19 deliverables +
  acceptance block ONLY.
- THIS Phase 19 starter prompt (so the agent and you share the plan).
- The SPECIFIC source files, each read individually (re-grep for the named anchor;
  line numbers drift):
    * src/ui/hud/a11y/announcer.ts (the Phase 3 announcer singleton + live regions;
      re-grep for the announcer class/export and its polite/assertive/log channels
      and the Reader-Mode gate flag).
    * The SimEvent dispatcher in the HUD. Re-grep for the event handler (search the
      modular hud for `handleEvents`, `SimEvent`, and the event-type switch); it
      may live in src/ui/hud/ now after the refactor. Summarize the event shapes it
      already receives (target change, damage/heal, cast start/stop/interrupt,
      cooldown ready, loot, level/quest) WITHOUT reading the whole giant hud.ts.
    * The instrumented windows from Phases 9-18 under src/ui/hud/<window>.ts: which
      roles, roving-tabindex, focus-traps, and t() labels each already exposes (so
      the SR-navigation audit checks against what exists, not from scratch).
    * The existing procedural WebAudio in src/game/ (re-grep for the WebAudio /
      audio-cue module: the synth/oscillator/panner entry points) so directional
      earcons reuse it; do NOT add an audio dependency.
    * src/ui/i18n.en.ts and the i18n entry (re-grep for `t(`, `supportedLanguages`,
      `formatNumber`/`formatMoney`/`formatDateTime`) so every new announcement and
      label is added as an English key the right way.
Give the Explore agent ONLY this list. It returns a summary; you do not re-read
these large files in the main loop.
Spawn a web-research agent ONLY if some external fact is genuinely missing from
research-brief.md (it should not be; the SR model is fully covered there).

================================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (fan out three agents)
================================================================================
Run as an ultracode Workflow. Give EACH agent ONLY the Explore summary (not the
raw docs). Request explicit fan-out. Use isolation: "worktree" only if two agents
would edit the same module in parallel; otherwise keep them on disjoint files and
merge sequentially.

Agent A - Announcer wiring + coalescing + throttling.
  Deliverables: wire the Phase 3 announcer (do NOT rebuild it) to the SimEvent
  dispatcher and IWorld reads for combat, target, cast, cooldown, and loot, per
  research-brief.md Section 4's per-surface plan:
    - Target frame -> status region, aria-atomic, on target CHANGE only; announce
      name + enemy TYPE + health percent (enemy type is the single highest-value
      combat cue).
    - Player HP/resource -> status, only on threshold crossings (not per tick).
    - Cast bar -> status on START ("Casting <ability>"), alert on INTERRUPT; never
      narrate the fill.
    - Cooldowns -> status, coalesced, user-selected abilities only.
    - Buffs/debuffs -> status with aria-relevant="additions removals".
    - Loot/quest -> status, with optional rarity earcons (hand off the earcon to
      Agent B).
  Implement coalescing/throttling EXACTLY per the brief: decouple from the rAF
  loop; buffer events and flush on a ~500-1000ms interval (make the interval a
  named, tunable constant); SUMMARIZE rather than enumerate ("took 65 damage over
  4 hits; health 55 percent"); REPLACE not append in transient status regions via
  a single textContent assignment; wrap any multi-node rebuild in aria-busy=true
  then false; CAP the pending queue at ~3 and drop oldest. Add verbosity tiers
  (combat: summary/off; loot: rarity-only/full) read from the Reader-Mode settings
  (the Options UI that sets them is Phase 21; here, read the setting and default
  sensibly). Numbers/percents in any string go through formatNumber/Intl, never
  concatenation. Every announcement string is a t() key in en.
  STOP CONDITION (surface immediately): if making combat intelligible would
  require any sim-side change, STOP. Announcements must be client-only, reading
  IWorld + the events the dispatcher already delivers. And if coalescing CANNOT
  keep combat announcements intelligible at 20Hz with the queue cap, STOP and
  document the ceiling rather than flooding the speech queue.

Agent B - Combat assists (client audio + confirmation paths).
  Deliverables:
    - Soft-target: auto/centered-target assist mirroring WoW Dragonflight Soft
      Targeting, reading IWorld for the candidate; this is a CLIENT targeting aid,
      not a sim change (it surfaces an intent the player already had).
    - Directional + HP earcons via the EXISTING src/game/ procedural WebAudio
      (reuse the synth/panner; no new dependency). Pan/pitch encode direction and
      threshold-crossing HP; each audio cue must have a HUD visual twin (no
      essential info by sound alone, per the BASIC GAG tier).
    - Click-to-move and click-cast CONFIRMATION paths: confirm the existing
      click/tap-to-move and click-cast routes are reachable and announced (cast
      confirmation through the status region); do NOT invent a new casting system.
      Use the WoW Click to Move / Click Casting facts only as the interaction
      model.
  Earcons and assists are CLIENT-only; they read IWorld + events and never mutate
  the sim (determinism, invariant 4). Any label/announcement is a t() key.
  STOP CONDITION: if any assist would need a sim-side change, STOP and surface.

Agent C - Screen-reader navigation audit + Reader-Mode behavior plumbing.
  Deliverables:
    - Audit EVERY menu/window (the Phases 9-18 set: Spellbook, Bags, Character,
      Talents, QuestLog, Social, Trade, Market, Arena, Options, plus the persistent
      chrome) for full SR navigability against what Phases 7/9-18 already
      instrumented: focus order on open/close, roving tabindex on grids/lists,
      modal focus-trap where applicable, every control has a t() accessible name +
      role + state. File concrete gaps; fix the gaps that are in scope here (the
      plumbing, not a re-style), and DEFER anything that belongs to a specific
      window's own pass.
    - Reader-Mode behavior plumbing: gate the announcer channels and the assists
      behind the Reader-Mode flag (off by default). The TOGGLE UI ITSELF IS PHASE
      21 - do NOT build the Options control; here you wire the flag's READ path and
      ensure that when Reader Mode is OFF there is ZERO per-frame cost (no live
      writes, no earcon scheduling, no announcer flush timer running) per invariant
      5. When ON, the channels and assists activate.
  Any new aria-label/announcement/title is a t() key in en.

Code hygiene (all agents): TypeScript strict; 2-space indent; reuse the Phase 3
utilities and the existing WebAudio; remove dead code/unused imports; uphold the
import invariant (src/sim stays DOM-free and is NOT touched); never hand-edit
generated files; add unit tests + axe a11y assertions alongside the code.

================================================================================
INVARIANTS THIS PHASE MUST KEEP (cited by number from state.md "Non-negotiable
invariants"; only those in play)
================================================================================
- Invariant 5 (Per-frame budget): when Reader Mode is OFF there is NO per-frame
  cost - no live-region writes, no earcon scheduling, no announcer flush timer.
  When ON, live writes happen on STATE CHANGE only (extend the hot-write dedup
  cache to aria attributes; meter/cast ARIA at a coarse cadence while the canvas
  animates smoothly), never per frame, and never via getComputedStyle on the hot
  path. The hot-write skip rate stays above ~0.8 (tests/hud_perf_budget.test.ts).
- Invariant 4 (Determinism): earcons are CLIENT audio and assists are CLIENT reads
  of IWorld + events; NO sim change, no Math.random/Date.now/performance.now in
  src/sim, sim stays DOM-free. HUD/audio may read wall-clock; the sim may not.
- Invariant 2 (t()-only render sink): EVERY new aria-label, announcement, status/
  alert/log string, and title is a t() key present for en (locales filled by the
  maintainer at release); add to src/ui/i18n.en.ts only, do NOT edit the locale
  overlays. Numbers/percents via formatNumber/Intl. The i18n guard
  (tests/localization_fixes.test.ts) must stay green.
- Invariant 6 (Accessibility does not regress gameplay): the input-mode gate must
  never swallow movement/hotkeys during normal play; Reader Mode and earcons must
  not break the game-input path.
- This packet DELIBERATELY changes presentation: if any visible chrome shifts,
  re-baseline the Playwright snapshots with a REVIEWED diff (locked decision 7),
  never an unreviewed --update-snapshots.
- Reminder (state.md): NO new IWorld member, SimEvent, wire field, endpoint, or
  table is expected. If one seems needed, STOP and surface it (it is a red flag).

================================================================================
OUT OF SCOPE (explicit exclusions)
================================================================================
- The Options Reader-Mode toggle UI and the verbosity-tier controls (Phase 21).
  Here you only READ the flag/settings and gate behavior.
- Any twitch-combat parity. Reflex-gated real-time combat is explicitly NOT
  promised; document the ceiling, do not chase parity.
- Any sim-side change (src/sim is not touched; no new SimEvent/IWorld member).
- The themes, text-scale UI, and reduced-motion toggle (Phase 21); the AAA pass
  (Phase 23); Edit Mode (Phases 25/27).

================================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================================
This is an A11y change of type "Reader Mode / announcer", so run the state.md
matrix rows for "A11y change" AND "Reader Mode / announcer":
1. `npx tsc --noEmit`
2. `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts`
   (perf skip rate must stay above ~0.8; confirm Reader-Mode-off adds no per-frame
   cost).
3. `npx vitest run tests/localization_fixes.test.ts` (every new label/announcement
   is a t() key).
4. axe-core a11y assertions: `npx vitest run tests/a11y` (and/or
   `npx playwright test tests/a11y`). Add live-region UNIT tests for the announcer
   wiring (assert: polite vs assertive routing, aria-atomic on the target/status
   region, aria-relevant additions+removals on the buff region, the ~500-1000ms
   coalesce/flush, replace-not-append in transient regions, the ~3-item queue cap
   dropping oldest, and ZERO writes when Reader Mode is off).
5. Visual baselines: `npx playwright test`. If any visible chrome changed, REVIEW
   the diff first, then re-baseline deliberately with
   `npx playwright test --update-snapshots`. Never update snapshots without
   inspecting the diff.
6. Playwright MCP live-game walkthrough (use the live-site creds from memory only
   as needed): drive the running client (`npm run dev` plus `npm run server`) and
   verify, with Reader Mode toggled on via the flag read path:
     - switch locale and confirm NO English leak in any announcement/label;
     - keyboard-only navigation reaches every menu control; visible focus ring
       survives the dark backdrop on every focusable element;
     - the announcer routes target/cast/loot through the correct channels and
       coalesces under simulated combat without flooding;
     - earcons fire with their visual twin and assists (soft-target, click-cast
       confirmation) are reachable;
     - toggle Reader Mode OFF and confirm gameplay input is unaffected and no
       per-frame announcer work runs.
7. Build / pre-merge (mirrors CI):
   `npm test && npx tsc --noEmit && npm run build:env && npm run build:server &&
    npm run build`. The final `npm run build` must show the game bundle does NOT
   pull in the dev-only a11y deps (axe-core).

Multi-agent review (review-dispatch rule: spawn ONLY the agents whose surface the
diff actually touches):
- This is a CLIENT-only diff (src/ui, src/game, tests). So spawn `qa-checklist`
  ONLY. Do NOT spawn migration-safety (no server/db change) or cross-platform-sync
  (no IWorld/sim/net change). If, against expectation, the diff touched IWorld or
  the sim/net wire, STOP - that is a red flag for this phase.
- For Opus 4.8: before declaring done, spawn ONE fresh subagent to review your own
  diff for correctness, a11y-spec conformance (channels/roles/coalescing match
  research-brief.md Section 4), and requirement gaps - NOT style.
- Prompt every review/QA agent for COVERAGE, not filtering: report every issue
  found, do not pre-prune. If an agent's output is truncated, resume it with:
  "Continue the review from where you were truncated; do not restart; report only
  the remaining findings." No commit while any BLOCKING finding is open.

================================================================================
STEP 4 - COMMIT CADENCE (explicit paths only; never git add -A)
================================================================================
Stage only this card's files by explicit path. Suggested 2-5 commits:
1. `feat(a11y): wire Reader Mode announcer to target/HP/cast/cooldown/loot`
   (Agent A: dispatcher wiring + coalescing/throttling + verbosity tiers).
2. `feat(a11y): combat assists - soft-target and directional earcons`
   (Agent B: client WebAudio earcons + soft-target + click-cast confirmation).
3. `a11y(ui): full screen-reader navigation across all menus`
   (Agent C: SR-navigation audit fixes + Reader-Mode behavior plumbing/gating).
4. `test(a11y): live-region unit tests + axe assertions for Reader Mode`
5. `docs(a11y): Phase 19 progress + state ledger (Reader Mode keys/utilities)`
   (plus any reviewed visual re-baseline in its own commit if chrome shifted:
    `style(ui): re-baseline Phase 19 visual snapshots (reviewed diff)`).

================================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 19)
================================================================================
- [ ] Announcer wired to target/HP/cast/cooldown/loot with coalescing/throttling.
- [ ] Assists: soft-target, directional earcons, click-to-move/click-cast paths
      confirmed.
- [ ] All menus fully SR-navigable; a manual screen-reader pass is recorded (note
      it for the QA phase; VoiceOver/NVDA is the manual leg).
- [ ] Reader Mode is opt-in (read the flag here; the Options toggle is Phase 21),
      off by default, with NO per-frame cost when off.
- [ ] The realistic ceiling is documented (menus/turn-based fully accessible;
      combat accessible via coalescing + assists; reflex-gated mechanics not
      parity-accessible).

================================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================================
- Update docs/hud-ux-and-accessibility/progress.md: set Phase 19 status to
  complete with the date; check the deliverable boxes; add a Notes entry capturing
  the coalesce interval and queue-cap values chosen, the verbosity-tier defaults,
  and the documented ceiling.
- Update docs/hud-ux-and-accessibility/state.md ledger: record the new Reader-Mode
  utilities/files, the new t() announcement keys added to en, the earcon hooks
  reused from src/game/ WebAudio, and any SR-navigation gap deferred to a window's
  own pass. Confirm "New IWorld members ... NONE" still holds.
- Memory: add a note under the hud/i18n topics summarizing where the announcer is
  wired, the coalescing constants, the Reader-Mode flag read path, and the
  honest-ceiling decision, so the next session does not relitigate it.
- Commit docs WITH the implementation (explicit paths).

================================================================================
STEP 7 - FINAL RESPONSE FORMAT (return verbatim)
================================================================================
- Status: complete / blocked, one line.
- Files touched: absolute paths grouped by Agent A/B/C + tests + docs.
- Validation results: tsc; harness + perf skip rate (number); i18n guard; axe
  results; live-region unit tests; whether visuals were re-baselined and the diff
  reviewed; the Playwright MCP walkthrough outcome (locale leak check, keyboard
  nav, focus visibility, Reader-Mode-off no-cost check); build:env/server/build
  with the no-dev-dep-in-game-bundle confirmation.
- Review verdicts: qa-checklist verdict and the fresh-subagent diff-review verdict
  (BLOCKING vs non-blocking; how each BLOCKING item was resolved).
- Deferrals: any SR-navigation gap pushed to a specific window's pass; the manual
  SR pass deferred to Phase 20 QA; the documented combat ceiling.
- One-line handoff to QA: point Phase 20 at the announcer channels, the coalescing
  constants, the assists, and the manual screen-reader pass to perform.

================================================================================
STOPPING RULES (stop and surface; do not push through)
================================================================================
- STOP if any announcement or assist would require a sim-side change. Everything
  must be client-only, reading IWorld + the events the dispatcher already
  delivers. A new SimEvent/IWorld member is a red flag.
- STOP and DOCUMENT THE CEILING if coalescing cannot keep combat announcements
  intelligible at 20Hz within the queue cap; do not flood the speech queue to fake
  parity. Reflex-gated combat is explicitly not promised at parity.
- STOP if the cross-packet checkpoint is unmet (no Phase 3 announcer, or windows
  not instrumented by Phases 7/9-18); do not rebuild the foundation here.
- STOP if git status is dirty with files that are not yours (shared worktree).
- STOP if a perf check shows any per-frame cost while Reader Mode is OFF
  (invariant 5), or if the i18n guard flags a non-t() string.
```
