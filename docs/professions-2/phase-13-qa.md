# Phase 13 QA: Verify Enchanting reachable

Audits the Phase 13 diff: enchanting AND salvage reachable in both hosts, replay-safe
destruction, live `ClientWorld` result mirroring, and complete tests and i18n for this phase.

## QA Starter Prompt

```
This is Phase 13 QA of the Professions 2.0 feature: verify Enchanting reachable.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 13 diff for correctness, missing tests, dead code, determinism, three-host
parity, and i18n completeness for this phase.

STEP 0 - PRE-FLIGHT: run git status; the tree must be clean (a concurrent session may share this
checkout); if it is dirty with work you did not create, stop and ask. Scan Claude Code memory
(the MEMORY.md index) for: the node25 gate rule (run npm run gate under Node 24), combo recipes
broken online (the #2033 ClientWorld stub trap), and the design-language program (today's tokens
only in UI work).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly): spawn one Explore agent to read and
summarize: docs/professions-2/state.md, docs/professions-2/progress.md,
docs/professions-2/phase-13-enchanting.md, and the output of git diff <phase-start>..HEAD (the
phase-start commit is recorded in progress.md). The summary must return: the phase's deliverable
groups and acceptance criteria, the actual IWorld members and wire keys that landed, every file
the diff touched, and the state.md validation rows that apply to the change type.

STEP 2 - QA AUDIT: spawn three parallel agents, each given ONLY the Explore summary:
- Correctness agent: verify every deliverable and acceptance criterion against the real code;
  run the phase's validation commands (net/wire row: npx vitest run tests/snapshots.test.ts
  tests/env_protocol.test.ts tests/bandwidth.test.ts tests/world_api_parity.test.ts; npx vitest
  run tests/professions_enchanting.test.ts plus the phase's new test files; npm run i18n:gen
  then npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts; npx tsc
  --noEmit); exercise the REAL behavior: actually disenchant an item, apply an enchant, and
  salvage a crafted item in the
  offline sim and against a running server, not just through the tests.
- Test coverage agent: find untested paths (server rejection branches, the signed/masterwork
  warning path, ClientWorld result mirroring, duplicate-command handling); add missing tests,
  including a determinism test if any sim logic changed; remove orphaned tests.
- Dead code and cleanup agent: unused imports and types in the diff, sim purity (no
  DOM/Three/render/ui/game/net imports in src/sim/, all randomness through Rng), leftover TODOs
  and debug residue.
Also spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md: check git diff --name-only and spawn ONLY matching
rows, plus the qa-checklist agent (the phase deliverable set is complete).
Prompt every agent for COVERAGE, not filtering: report every correctness or requirement gap with
confidence and severity; the main session filters afterward.
If any agent's output is truncated, re-spawn it to resume from its last completed item; never
restart finished work.

PHASE-SPECIFIC QA EMPHASIS (probe these directly, not just by reading):
- Replay and race safety on destruction: fire the same disenchant and salvage commands twice
  (duplicate and
  replay) and prove exactly one destruction and one grant; race each against a
  concurrent move or trade of the same item and prove no dupe or double-destroy.
- ClientWorld last-result mirroring: confirm the
  lastDisenchantResult/lastEnchantResult/lastSalvageResult reads
  are LIVE in ClientWorld (values actually arrive over the wire and update after each command),
  not shape-only stubs (the #2033 trap). lastSalvageResult is the one brand-new read: probe it
  hardest.
- Confirm-dialog focus trap: keyboard focus stays inside the confirm dialog, Escape cancels,
  and Enter cannot silently destroy a signed or masterwork instance without the explicit
  warning path.
- Prime directive spot check: no existing bags, trade, equip, or bank flow changed behavior
  unless the player invokes the new actions; salvage carries the same replay-safety and
  warning guarantees as disenchant (probe it with the same duplicate/race protocol).

STEP 3 - FIX: apply every BLOCKING and SHOULD-FIX finding; rerun the failed validation rows
until green; commit with explicit paths (never git add -A), Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY: update docs/professions-2/progress.md with the QA row and
verdict; correct docs/professions-2/state.md if the audit found the recorded Phase 13 surfaces
wrong; record genuine surprises to Claude Code memory.

STEP 5 - FINAL RESPONSE FORMAT: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of findings by
severity and how many were fixed versus deferred; the deferral list with reasons; a one-line
handoff to the next phase.

STOPPING RULES: none special for this phase. Stop and surface to the user only if a BLOCKING
finding cannot be fixed without changing a locked decision in state.md, or if the pre-flight
tree is dirty with work you did not create.
```
