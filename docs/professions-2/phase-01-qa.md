# Phase 01 QA: Verify Ring and identity foundations

Audit the Phase 01 ring reorder, pair-named archetype identity, and PR 2039 review resolutions
before Phase 2 builds on the new canonical pair ids.

## Phase-specific QA emphasis

- Hunt every derivation of ring order: grep for index math on `CRAFT_RING` (`indexOf`, modulo
  and offset arithmetic, adjacency helpers) across `src/` and `tests/`; any survivor still
  encoding the old rotation is BLOCKING.
- Verify `attunedPairs` round-trips with the new canonical pair ids: serialize, load through
  `normalizeArchetypeState`, attune again; a pre-reorder fixture must map or cleanly default.
- Verify no i18n key orphans from the practitioner-title retirement: retired keys absent from
  the catalog and generated bundles, no consumer still references them, and the ten new pair
  keys are complete.

## QA Starter Prompt

```
This is Phase 01 QA of the Professions 2.0 feature: Verify Ring and identity foundations.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 01 implementation for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for THIS phase (ring reorder, pair-named titles, the
PR 2039 review resolutions).

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean (the Phase 01 implementation should already be committed). If
  dirty, ask the user (a concurrent session may share this checkout).
- Memory scan: check the MEMORY.md index for entries relevant to this phase, at minimum: the
  node25 gate rule (run npm run gate under Node 24), the PR 2039 state, and the
  combo-recipes-broken-online entry (#2033, the ClientWorld stub trap for professions wire
  parity).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, what Phase 1 recorded under
  "New surfaces per phase")
- docs/professions-2/progress.md (the Phase 1 deliverable checklist and claimed status)
- docs/professions-2/phase-01-ring-and-identity.md (what was promised: deliverables, acceptance
  criteria, stopping rules, and the phase-specific QA emphasis in the same file's companion,
  docs/professions-2/phase-01-qa.md)
- The full diff of Phase 01: git diff --name-only and git diff against the phase-start commit
The summary must return: the full list of Phase 01 deliverables and acceptance criteria, every
file created or modified, the new hudChrome pair-title key names, the re-pinned test names, the
PR 2039 resolution status, and any known issues or deferrals noted in progress.md.

STEP 2 - QA AUDIT:
Spawn THREE parallel audit agents (explicit fan-out), each given ONLY the Explore summary.
Prompt each for COVERAGE, not filtering: report every issue including low-severity and
uncertain ones; ranking happens in a later step.

Correctness agent:
- Verify every Phase 01 deliverable was actually implemented and every acceptance criterion in
  the phase prompt is met.
- Run the phase's validation commands: npx tsc --noEmit; npx vitest run
  tests/professions.test.ts tests/archetype_ceiling.test.ts tests/combo_eligibility.test.ts
  tests/snapshots.test.ts tests/world_api_parity.test.ts; npx vitest run
  tests/architecture.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts; npm run
  i18n:gen then npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts.
- Exercise the real behavior, not just the tests: confirm CRAFT_RING matches the blueprint
  order; confirm both COMBO_RECIPES pairs pass combo_eligibility under the new ring; confirm
  getArchetypeTitle resolves the pair name on the identity card, attunement preview, dialog
  labels, and nameplate title path in BOTH the offline Sim and the online ClientWorld
  (liveness, not member shape: the 2033 stub trap).
- EMPHASIS: hunt every derivation of ring order. Grep src/ and tests/ for index math on
  CRAFT_RING (indexOf, modulo or offset arithmetic, adjacency helpers); any surface still
  encoding the old rotation is BLOCKING.
- EMPHASIS: verify attunedPairs round-trips with the new canonical ids. Build a fixture
  ArchetypeState with pre-reorder pair ids, load it through normalizeArchetypeState, and
  confirm it maps or cleanly defaults; then attune, serialize, and reload to confirm the new
  ids are stable.
- Verify the five PR 2039 should-fix items are actually closed (matcher rows for the two
  quest_commands.ts error strings plus the S3 scan-list line, the "Part of #1295" reword, the
  13 Latin-overlay hand fills reverted, commit bodies present, PRD staleness fixed).

Test coverage agent:
- Identify new or changed code paths without tests (ring derivation helpers, pair-id
  canonicalization, the normalizeArchetypeState back-compat branch, the title resolution path).
- Add missing tests, including a same-seed determinism test if any sim logic (not just content
  data) changed in this phase.
- Verify the re-pins are deliberate assertions of the new canonical values, never loosened or
  deleted assertions; verify the combo-pair adjacency pin exists.
- Update tests broken by the phase; remove orphaned tests for the retired practitioner titles
  or the old ring order.
- Verify assertions are decisive (they would fail if the behavior regressed), not just "it
  runs".

Dead code and cleanup agent:
- Find unused imports, functions, types, and constants left behind by the reorder and the title
  retirement.
- EMPHASIS: verify no i18n key orphans from the title retirement. The ten retired per-craft
  practitioner keys are absent from src/ui/i18n.catalog/hud_chrome.ts and the generated
  bundles, no locale-overlay rows dangle, and no consumer still references them; the ten new
  pair keys (Smith, Outfitter, Apothecary, Bombardier, Trapper, Mageweaver, Arcanist,
  Gembinder, Bladewright, Cogsmith) are all present in English only.
- Verify sim purity holds: src/sim/ has no DOM, Three.js, render, ui, game, or net imports, and
  no Math.random / Date.now / performance.now.
- Check for leftover TODO or FIXME items, commented-out code, and naming inconsistent with the
  surrounding modules.

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only against the phase-start
commit and spawn ONLY the matching rows, plus the qa-checklist agent (this is the
phase-completion QA gate). Prompt each for COVERAGE, not filtering.
Resume any agent that truncates with: "Stop reading more files. Output the full report now
based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX item.
- Rerun the validation commands from STEP 2 (the net/wire, sim, and i18n matrix rows plus the
  phase suite list) until green.
- Commit the fixes with EXPLICIT paths, never git add -A; Conventional Commits with a scope and
  a body, separate from the doc updates so the history stays reviewable.

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md: mark Phase 1 QA complete; note anything deferred to a
  follow-up.
- Update docs/professions-2/state.md with any drift QA discovered (a missed derivation site, a
  corrected key name, a revised locked decision).
- Record to memory any surprising rule learned during QA.

STEP 5 - FINAL RESPONSE FORMAT:
End your turn with: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts of BLOCKING,
SHOULD-FIX, and NICE-TO-HAVE items found and fixed, deferred items, and a one-line handoff for
the Phase 2 implementation session.

STOPPING RULES:
- Stop and surface to the user if any BLOCKING item cannot be fixed without changing the phase
  scope.
- Stop and surface to the maintainer if QA finds that any production player already holds
  attunedPairs pair ids derived from the old ring (a save migration becomes required).
- Stop and surface to the maintainer if PR 2039 did not merge inside its window; Phase 2 must
  not start on an unmerged foundation.
```
