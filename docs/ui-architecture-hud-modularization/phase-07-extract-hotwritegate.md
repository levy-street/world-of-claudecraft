# Phase 7 starter prompt: Extract HotWriteGate (card P1-A)

Paste everything inside the fenced block below into a fresh Claude Code session.
It is self-contained: do not rely on this surrounding text at runtime.

### Starter Prompt

```
This is Phase 7 of the UI Architecture and HUD Modularization feature: Extract HotWriteGate.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (one tightly-coupled class plus one unit test). Run it inline as a normal session. Do NOT add the keyword ultracode and do NOT orchestrate via a Workflow.

GOAL
Move the write-side dedup machinery out of src/ui/hud.ts into a standalone HotWriteGate class (one Map cache, the four setters setText/setDisplay/setTransform/setWidth, the hotDomWrites/hotDomSkippedWrites counters, and a stats() accessor), with its own unit test, threaded into Hud as exactly one instance passed by reference.

STEP 0 - PRE-FLIGHT
1. Run: git status --porcelain. This checkout may be shared by a concurrent session. If it is dirty with files you did not create, STOP and ask the human before touching anything; do not stash or revert another session's work.
2. Confirm you are on a fresh branch for this card. Create one if needed: git checkout -b feature/p1-a-hot-write-gate (branch off the current packet branch; do NOT work on main).
3. Memory scan: read ~/.claude memory MEMORY.md and the topics relevant here: i18n-resolved-baseline-and-assembly, shared-worktree-commit-care, never-push-to-fork, no-em-dashes-or-emojis. Honor them (stage only this card's files with explicit paths; push to origin levy-street, never the fork; no em dashes or emojis anywhere).

STEP 1 - LOAD CONTEXT (do not read the planning docs or src/ui/hud.ts in the main loop; they are large; save context)
Spawn ONE Explore agent. Instruct it to read and return a tight summary of:
- docs/ui-architecture-hud-modularization/state.md (locked decisions, the non-negotiable invariants list, the validation matrix, the review-dispatch matrix, the Anchors index, and the OPEN items).
- docs/ui-architecture-hud-modularization/progress.md (Phase 7 deliverables and acceptance ONLY).
- This Phase 7 starter prompt (the section you are reading).
- The SPECIFIC source it must characterize in src/ui/hud.ts, found by re-grepping symbols (line numbers in state.md DRIFT; anchor on the symbol, not the number):
  - The hotWriteCache field declaration (grep: hotWriteCache).
  - The four setters and their exact bodies (grep: setText, setDisplay, setTransform, setWidth). Capture the EXACT string formatting each one produces (the cached-value key, the comparison, what gets assigned to textContent / style.display / style.transform / style.width). This is byte-significant.
  - The counter fields and every read/write of them (grep: hotDomWrites, hotDomSkippedWrites).
  - perfStats() and hotDomSkipRate (grep both) - how the skip rate is computed and surfaced, since the test and the perf gate read it.
  - Every CALL SITE of the four setters and the counters inside hud.ts (so the migration rewires them to the new instance and nothing is left referencing the old fields).
The Explore agent returns: the exact current bodies, the field/counter shapes, the skip-rate computation, and the full call-site inventory. No external surface is named in this phase, so do NOT spawn a web-research agent.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
This is tightly coupled, so a single implementing agent is the default. Optionally, AFTER the class file lands, run a second agent in parallel to author the unit test. If you fan out, request fan-out explicitly and give each agent ONLY the Explore summary (never the raw planning docs or the whole hud.ts).

Agent A (implementer) - deliverables:
- New file src/ui/hud/hot_write_gate.ts exporting a HotWriteGate class with: one private Map cache (the moved hotWriteCache), the four public methods setText/setDisplay/setTransform/setWidth with bodies copied VERBATIM (same key, same comparison, same assignment, same string formatting - byte-identical), the two counters as internal state, and a stats() accessor returning the data perfStats()/hotDomSkipRate need (e.g. writes, skipped, and/or the computed skip rate - match exactly what hud.ts currently exposes).
- Edit src/ui/hud.ts: delete the moved field/counter declarations and the four method bodies; construct exactly ONE HotWriteGate instance in the Hud constructor (grep the ctor anchor; re-find it); rewire every call site to call through that single instance by reference; make perfStats()/hotDomSkipRate read from the instance's stats(). Do not duplicate the cache anywhere.
- Remove now-dead imports/fields; add the import of HotWriteGate.

Agent B (optional, test) - deliverable:
- New file tests/hot_write_gate.test.ts. It instantiates HotWriteGate directly and asserts: (a) a repeated identical write is skipped and increments the skipped counter; (b) a changed value writes and increments the write counter; (c) each setter applies the correct DOM property with byte-identical formatting (textContent / style.display / style.transform / style.width); (d) stats()/skip-rate math matches the pre-extraction behavior. Use a DOM env per-file (// @vitest-environment happy-dom; fall back to jsdom only if an API is missing) - do NOT flip the global Vitest env; the pure sim suite stays on node.

INVARIANTS THIS PHASE MUST KEEP (from state.md "Non-negotiable invariants")
- Invariant 4 (One shared hotWriteCache): extraction threads a SINGLE HotWriteGate instance by reference; never duplicate the cache per module. After the edit, grep must prove there is no second cache Map anywhere (no leftover hotWriteCache in hud.ts, no per-call new Map).
- Invariant 5-adjacent (write semantics / string formatting BYTE-IDENTICAL): the 7 recompute signatures downstream depend on the exact strings these setters produce. Every cached key, comparison, and assigned value must be unchanged. A formatting drift is a silent stale-UI bug with no compile guard.
- Invariant 6 (per-frame core stays imperative, no added per-frame allocations): the setters run in the hot path; do not add allocations, closures, or wrappers per call. The skip-rate gate must stay green (skip rate > 0.8).
- Invariant 3 (DOM id/class contract): unchanged - this card touches no ids/classes, keep it that way.
- Invariant 2 (t()-only render sink): no player text is added or moved here; preserve it untouched.
- Invariant 8 (shared-worktree commit hygiene): stage only this card's files with explicit paths, never git add -A.
- Invariant 9: no em dashes or emojis in code, comments, or docs.

OUT OF SCOPE (do not do these; they belong to later phases)
- Do NOT extract any window (Spellbook, etc. are Phase 13+).
- Do NOT extract ReactiveDiff/StructuralDiff or migrate any signature site (Phase 9).
- Do NOT extract IconService or define HudContext (Phase 11).
- Do NOT change any setter SIGNATURE or its formatting LOGIC; this is a move, not a redesign.
- Do NOT touch per-frame core BEHAVIOR (player/target frame, cast bar, action bar, auras, minimap) beyond rewiring the setter calls to the instance.
- Do NOT add any new IWorld member, SimEvent, wire field, or i18n key (state.md: NONE expected this packet; any addition is a red flag - STOP and surface it).
- Do NOT add a runtime dependency; happy-dom/jsdom are devDependencies only.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation commands for this DOM/UI-logic change type (state.md validation matrix):
- npx vitest run tests/hot_write_gate.test.ts tests/hud_perf_budget.test.ts tests/hud_harness.test.ts
- npx tsc --noEmit
- npm run build
All must be green. The perf budget test (hud_perf_budget) proves the skip rate stayed above the floor; if it regresses, the extraction changed semantics - STOP and fix before continuing. No player text changed, so the S3 i18n guard (tests/localization_fixes.test.ts) is not required by the matrix for this card; if you discover any matcher/player-string touch, add npx vitest run tests/localization_fixes.test.ts.

Multi-agent review (review-dispatch matrix): check git diff --name-only against the phase-start commit. This card touches only src/ui (hud.ts + hud/hot_write_gate.ts) and tests, so spawn qa-checklist ONLY. Do not run privacy-security-review, migration-safety, or cross-platform-sync (no server/net/sim/IWorld/matcher surface in the diff). Also run a fresh subagent to review your own diff for correctness and requirement gaps (not style): specifically that the cache is single-instance, the formatting is byte-identical, and no call site still references the old fields.
- Prompt every review agent for COVERAGE, not filtering: "Report every issue including low-severity and uncertain ones; ranking is a later step."
- If any review agent truncates, resume it with exactly: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Do not commit until each review reports no BLOCKING issues.

STEP 4 - COMMIT CADENCE (explicit paths only; never git add -A)
Suggested 2 to 3 commits:
1. refactor(ui): extract HotWriteGate from hud.ts (paths: src/ui/hud/hot_write_gate.ts, src/ui/hud.ts)
2. test(ui): unit-test HotWriteGate write dedup and counters (path: tests/hot_write_gate.test.ts)
3. docs(ui): record HotWriteGate extraction in packet progress and state (paths: docs/ui-architecture-hud-modularization/progress.md, docs/ui-architecture-hud-modularization/state.md)
Push the branch to origin (levy-street), never the FernandoX7 fork. Open one PR for this card if the human asks; otherwise leave it pushed.

STEP 5 - ACCEPTANCE CRITERIA (mirrors progress.md Phase 7; all must hold)
- [ ] src/ui/hud/hot_write_gate.ts exists with one Map, the four setters, the counters, and stats().
- [ ] Exactly one HotWriteGate instance lives in Hud, threaded by reference; grep proves no duplicate cache (no leftover hotWriteCache field, no second Map).
- [ ] Write semantics and string formatting are byte-identical to the pre-extraction setters (the signatures that depend on them are unaffected).
- [ ] tests/hot_write_gate.test.ts passes and the perf skip-rate gate (hud_perf_budget) stays green.
- [ ] npx tsc --noEmit and npm run build are green; the game bundle gained no runtime dependency.

STEP 6 - DOC UPDATES + MEMORY
- progress.md: set Phase 7 row to complete (fill Started/Completed dates); tick every Phase 7 acceptance checkbox; add any deferral to the Notes section.
- state.md: in the "Created by this packet (ledger)" section, mark (Phase 7) src/ui/hud/hot_write_gate.ts and tests/hot_write_gate.test.ts as landed; update "Current phase"; if you resolved or hit an OPEN item or gotcha (for example a happy-dom canvas gap), record the resolution there.
- Memory: if anything was surprising or load-bearing for later phases (the exact shape of stats()/skip-rate, a setter formatting subtlety, or where the single instance is constructed), add a short note so Phases 9 and 11 inherit it.

STEP 7 - FINAL RESPONSE FORMAT (return this and nothing extraneous)
- Phase status: complete or blocked (with reason).
- Files touched: absolute paths, grouped new vs edited.
- Validation results: the exact command outcomes (vitest files, tsc, build), and the measured skip rate from the perf gate.
- Review verdicts: qa-checklist verdict and the self-diff subagent verdict (BLOCKING/SHOULD-FIX/NICE-TO-HAVE counts).
- Deferrals: anything pushed to a later phase or left for QA.
- One-line handoff to the Phase 8 QA session.

STOPPING RULES (stop and surface to the human rather than guessing)
- STOP if any setter's string formatting (cached key, comparison, or assigned value) would change in any way; this card is a verbatim move, not a rewrite.
- STOP if more than one cache instance appears to be needed (the design assumes exactly one shared instance; needing two is a signal the seam is wrong).
- STOP if the perf skip-rate gate regresses below the floor after the move.
- STOP if the diff would touch server/, src/net/, src/sim/, src/world_api.ts, the matchers, or any id/class in index.html (out of scope; a sign you overreached).
- STOP if the checkout is dirty with another session's files (pre-flight), and ask before proceeding.
```
