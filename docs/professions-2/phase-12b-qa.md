# Phase 12b QA: Verify Gathering rhythm

Audit the Phase 12b implementation (the gather cast, the fishing bite minigame, rod synergy,
cue routing) for correctness, missing tests, dead code, determinism, three-host parity, i18n
completeness, and, uniquely for this phase, faithful execution of the phase file's Pin-cost
appendix.

As-landed inputs (2026-07-20, swept from the phase build; read the phase file's As landed
block and state.md's Phase 12b entry before auditing):
- The bite-state storage choice: three transient Entity fields (fishBiteAtTick,
  fishReelDeadlineTick, gatherCastNodeId); the module-local-map cleanup arm in the coverage
  charter below is therefore MOOT (no eviction discipline exists to audit; audit the
  cancel-path clears instead).
- Pin moves land OUTSIDE the appendix by design in two classes, and are NOT blocking
  findings. Cue-census extensions for the six new cues: game_audio 14 to 20,
  sfx_manifest 181/36 to 187/42, and the Phase 11 gather_event_i18n "fishingResult is
  cue-free" pin re-pinned to "plays only the reel cue" (the phase mandates the reel cue;
  the loot-hub cue absence is still pinned). The synchronous-drive family (an appendix
  inventory miss found and recorded at build time): gather_rare_events,
  gather_rare_event_online, prof_intro_quest, and profession_quest_objectives, each
  re-driven through cast completion via a local completeCastNow helper. Audit all of
  them for decisiveness, then treat them as the additive-extension class (the Phase 9
  command census precedent), not appendix violations. Any OTHER unlisted pin move stays
  BLOCKING.
- The reel arm lives in startFishing's busy gate, not items.ts useItem's generic busy
  branch (the useItem fishing arms route to startFishing first); audit the re-press paths
  there.
- tests/gather_open_gate.test.ts and tests/gather_node_online.test.ts are deliberately
  unchanged (reasons in the phase file's As landed block); the online arms live in
  gather_node_harvest's live GameServer describe and gather_node_interact's new describe.
  Auditing their absence THERE is in scope; their absence in the two unchanged files is not.

## QA Starter Prompt

```
This is Phase 12b QA of the Professions 2.0 feature: verify Gathering rhythm.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 12b diff for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness, and verify every Pin-cost appendix row was executed
as briefed, then fix what the audit finds.

STEP 0 - PRE-FLIGHT:
- Run git status; the checkout must be clean (a concurrent session may share it). Stop if
  dirty with work you did not create.
- Memory scan (MEMORY.md index): node25-breaks-jsdom-gate (gate under Node 24),
  combo-recipes-broken-online (the 2033 stub trap), and the professions packet entries.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize: docs/professions-2/state.md (the 2026-07-20
amendments block and the Phase 12b surfaces entry), docs/professions-2/progress.md,
docs/professions-2/phase-12b-gathering-rhythm.md INCLUDING the Pin-cost appendix verbatim,
and the git diff against the phase-start commit recorded in progress.md Notes (plus
--name-only for the file list). The summary must return: every deliverable and acceptance
criterion, the appendix rows with their briefed dispositions, the bite-state storage choice
the implementation actually made (and its recorded golden consequence), the shared
predicate's name and consumer list, and the validation command set.

STEP 2 - QA AUDIT (three parallel agents on the Explore summary; prompt each for COVERAGE,
not filtering; resume truncated agents, never act on a truncated report):

Correctness agent:
- Verify every deliverable and acceptance criterion against the real code.
- Run the phase's validation commands and record each result.
- Exercise the REAL behavior in the offline sim: a bare gather cast at base speed, a faster
  cast with a higher-tier tool, a faster cast at a higher proficiency band, the floor, a
  cancel by moving, completion denial after the node respawn state changes mid-cast, after
  bags fill mid-cast, and after walking out of range mid-cast; a fishing cast through
  bite and reel inside the window, a miss one tick past the deadline, an immediate recast,
  rod synergy on both the delay and the window; the codfather branch as pinned.
- Prove the anti-cheat invariant with a probe, not a read: walk every broadcast snapshot
  field for a mid-cast angler (a live GameServer round trip) and show nothing correlates
  with the bite tick; castRem/castTot must not count down to the bite.
- Verify both hosts surface the same lines and cues (liveness, not member shape).

Appendix-fidelity agent (this phase's special role):
- Take the Pin-cost appendix row by row and verify each was executed exactly as briefed:
  the re-pinned draw contracts, the re-recorded band literals (and that each new literal
  contains a draw inside a band-DISCRIMINATING window), the sim.test and casting_command
  re-pins, the readout reword traps (no em dash, status-registry update, the substituter
  coupling intact), the professions_gather golden regen with a RE-HUNTED seed whose
  rare-event window still fires, the two fishing-cancel parity scenarios verified-not-regened,
  the bite-state storage decision recorded in state.md with its golden consequence, and the
  five-site SimContext append with its pinned name list.
- Any pin moved that the appendix does NOT list, or any appendix row skipped without a
  recorded deviation, is a BLOCKING finding.

Test coverage and cleanup agent:
- Find untested paths: the deadline boundary tick, re-press outside the window, re-press
  with the wrong item, simultaneous damage-cancel and bite, gather completion re-validation
  arms, the hidden-state cleanup on player eviction (if the module-local map was chosen),
  determinism (same seed, same bite and catch sequence).
- Verify no orphaned pins from the old fixed-cast model survive; verify the placeholder cue
  rows are marked PLACEHOLDER, pass sfx:check, and are all listed on issue #2208.
- Dead code, sim purity (architecture.test.ts), unused imports, leftover debug.

PHASE-SPECIFIC QA EMPHASIS:
- The hidden bite delay: prove it is unreadable from the wire, not just untested.
- The appendix contract: the phase promised a CLOSED set of re-pins; hold it to that.
- Fairness and accessibility: the bite moment must be visible (bobber) as well as audible,
  identical across graphics presets; the window generous.
- Prime directive: everything gatherable/catchable before the phase remains so; only the
  rhythm changed.

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md over the phase diff, plus qa-checklist (the
phase-completion gate). Prompt each for COVERAGE, not filtering.

STEP 3 - FIX: apply every BLOCKING and SHOULD-FIX finding; rerun the touched validation
rows; commit with explicit paths (never git add -A), Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY: update docs/professions-2/progress.md (QA row and verdict)
and state.md (drift found, storage-choice corrections); record surprises to memory.

STEP 5 - FINAL RESPONSE FORMAT: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts by
severity, fixed vs deferred; the appendix-fidelity report; deferrals with reasons; a
one-line handoff for the Phase 13 session.

STOPPING RULES:
- Stop if the audit finds the bite delay readable from any broadcast field; that is a
  design breach, not a test gap.
- Stop if fixing a finding would weaken a pin outside the appendix set.
- Stop if the tree is dirty with work you did not create.
```
