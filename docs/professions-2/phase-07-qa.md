# Phase 07 QA: Verify The Guild letter

Independent audit of the Phase 07 diff: correctness of the trend classifier and the one-shot
letter delivery, test coverage, dead code, determinism, three-host parity, and i18n
completeness for this phase.

## Phase-specific QA emphasis

- Threshold hysteresis: skill values hovering at, crossing, and re-crossing the letter
  threshold must never re-fire the letter; prove the one-shot sent flag, not a re-evaluated
  predicate, is the gate.
- Offline vs online delivery parity: the letter must arrive identically in the offline `Sim`
  and through the server-authoritative online path; watch for the ClientWorld stub trap
  (verify liveness of the mail surface online, not just member shape).
- Backfill single-fire proof: a legacy character loaded already far past the threshold gets
  exactly one letter on first evaluation and never another on later loads, logins, or skill
  changes; no burst across multiple qualifying pairs.
- The vertical-slice checkpoint (2026-07-17 amendment): this QA session is the kernel
  exit. Drive the eight-step journey end to end in one seeded run: gather until a rare
  event fires, craft, watch skill and the next-unlock line move, receive the Guild letter,
  visit the letter's named quest giver and attune via the quest flow (the Phase 8 master
  NPCs do not exist yet at this checkpoint; smith_haldren and the 2039 intro-quest givers
  stand in, and the letter must name a giver that actually exists), proc and celebrate a
  masterwork (toast plus the zone-visible broadcast, if Phase 6 has landed; the personal
  toast alone if not), and trade the result. A step that is mechanically present but
  experientially broken (silent, illegible, or celebration-free) is a SHOULD-FIX at
  minimum, never a pass.

## QA Starter Prompt

```
This is Phase 07 QA of the Professions 2.0 feature: verify The Guild letter.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 07 diff for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness; fix what the audit finds; leave the phase in a
provably shippable state.

STEP 0 - PRE-FLIGHT:
- Run git status; the checkout must be clean. If dirty, stop and report.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries; at minimum read:
  node25-breaks-jsdom-gate (run the gate under Node 24), combo-recipes-broken-online (the
  ClientWorld stub trap that parity checks must not repeat), and the PR 2039 professions
  state.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-07-guild-letter.md (the phase file, including its acceptance
  criteria and validation commands)
- git diff against the phase-start commit recorded in the Phase 7 handoff (fall back to the
  last commit before the first Phase 7 commit if unrecorded): file list plus the full diff
  of the sim, content, matcher, and test changes
The summary must return: every Phase 07 deliverable and acceptance criterion; the actual
files and symbols the phase added or changed (the trend module and its exported
letter-threshold constant, the letter content id, the one-shot PlayerMeta flag, the S3 scan
list change); the validation commands the phase file names; any acceptance criterion the
implementation session marked deferred; and anything in the diff the phase file never asked
for.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents; give each ONLY the Explore summary. Prompt every agent
for COVERAGE, not filtering: report every gap with confidence and severity (BLOCKING /
SHOULD-FIX / NIT); filtering happens in STEP 3. If any agent's output is truncated, spawn a
fresh agent to resume from the last complete item rather than re-running the whole audit.

Agent correctness:
- Verify every deliverable and acceptance criterion in phase-07-guild-letter.md against the
  real code, not the phase session's claims.
- Run the phase's validation commands (npx tsc --noEmit; npx vitest run
  tests/localization_fixes.test.ts tests/professions_skill.test.ts; the new trend and letter
  test files; tests/architecture.test.ts; npm run i18n:gen then
  tests/i18n_completeness.test.ts).
- Exercise the real behavior, not just the tests: drive a sim where a fresh character
  crosses the threshold (exactly one letter, correct master named); an attuned character
  (no letter); a hovering skill value crossing the threshold repeatedly (no re-fire:
  threshold hysteresis); a legacy high-skill save (exactly one backfill letter, then silence
  across repeated loads).
- Prove offline vs online delivery parity: the letter reaches the player identically via the
  offline Sim and the server-authoritative online path; confirm the online mail surface is
  live, not a stub default (the 2033 trap).
- Play the vertical slice (the kernel-exit checkpoint from the QA emphasis above): the
  eight-step journey in one seeded run, recording where each beat surfaces (loot line,
  toast, mail, broadcast, title). Report the experiential gaps, not just the mechanical
  ones; they are findings like any other.

Agent test coverage:
- Find untested paths: threshold boundary values, adjacency and tie-breaking between pairs,
  the attuned skip, sent-flag persistence round-trip, the backfill guard across multiple
  loads, and the tutorial-panel single-render fix if this phase made it.
- Add missing tests, including a determinism test if sim logic changed (same seed and same
  inputs produce the same letter on the same tick).
- Remove orphaned tests the phase left behind or made meaningless.

Agent dead code and cleanup:
- Unused imports, types, and exports introduced by the phase; leftover TODOs and debug
  logging.
- Sim purity: no DOM/browser/Three imports and no Math.random, Date.now, or performance.now
  anywhere the phase touched in src/sim/.
- Catalog and matcher hygiene: no orphaned t() keys, no English fallbacks outside the
  catalog, locale overlays untouched.

Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
matching rows. Because the Phase 07 deliverable set is complete, also spawn the qa-checklist
agent over the full phase diff. Prompt them all for COVERAGE, not filtering.

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX finding; record NITs as follow-ups if not worth the
  churn.
- Rerun the full STEP 2 validation command set until green, plus npm run ci:changed; format
  only changed files with a scoped npx @biomejs/biome check --write <file>.
- Commit fixes with explicit paths, never git add -A; Conventional Commits with a scope and
  a body (for example fix(professions): ..., test(sim): ...).

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md: the Phase 7 QA row (status, dates), mirror any
  checkbox changes, and append deferrals and surprises to Notes.
- Update docs/professions-2/state.md if QA changed any surface the phase recorded (renamed
  symbols, a changed flag default, an added test pin).
- Record genuine surprises to Claude Code memory.

STEP 5 - FINAL RESPONSE FORMAT:
Report: verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL); finding counts by severity and how many
were fixed vs deferred; the validation command results; deferrals with owners; and a
one-line handoff for the next phase session (Phase 8, stations and masters).
(The packet-teardown offer is Phase 15 QA only and does not apply to this phase.)

STOPPING RULES:
No phase-specific rules. Baseline applies: stop and report if pre-flight finds a dirty
checkout or the phase-start commit cannot be identified; never commit past a BLOCKING
finding; the verdict is FAIL if any acceptance criterion cannot be verified against the real
code.
```
