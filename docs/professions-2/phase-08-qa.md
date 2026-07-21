# Phase 08 QA: Verify stations and masters (sim and server)

Independent audit of the Phase 8 diff: correctness, test coverage, dead code, determinism,
three-host parity, and i18n completeness for the typed station registry, the six masters, the
hands-vs-stations gate, and the placement-safety proof.

## Phase-specific QA emphasis

- The nine hub recipes' migration to typed stations, with special attention to the three
  `CASTER_HUB_RECIPES`: crafting them at their station must behave exactly as it did under
  `requiresHubStation` in gate order and proximity radius. The LEVEL rule is the one
  DELIBERATE change (the 2026-07-17 placement ruling): `CRAFTING_HUB_MIN_LEVEL` is retired
  and no station gate reads player level; verify the retirement is complete AND that no
  recipe strands for any character in the transition (do not report the level-gate removal
  as a regression).
- The multi-zone placement (2026-07-17 ruling): the placement-safety derivation runs PER
  ZONE (the Fenbridge tannery checks zone 2 camps, the Highwatch apothecary zone 3 camps),
  and the master-to-zone assignment pin (four archetype anchors in zone 1; tannery
  Fenbridge; apothecary Highwatch) matches the state.md default as literals.
- The deny reason localization (AS LANDED, the Phase 6 text-free-id precedent): the sim emits
  the stable id `station_required` on the `craftResult` SimEvent (no free text, no `sim_i18n`
  matcher row needed); `src/ui/hud.ts` maps it to `hudChrome.crafting.stationRequired`,
  interpolating `stationName.<type>` resolved from `recipeById(ev.recipeId)?.stationType`.
  Verify THAT path end to end; the S3 guard (`tests/localization_fixes.test.ts`) stays green by
  construction, and no raw id or English concat ever reaches the player.
- FIELD_RECIPES exactness: the set is EXACTLY the pre-phase nine `COMMON_RECIPES` ids, nothing
  more, nothing fewer; each of the nine crafts away from every station and via the T window.
- The placement test derives from spawn content (camps plus `aggroRadius`), not hardcoded
  coordinates, and demonstrably fails when a master is placed next to a hostile spawn.

## QA Starter Prompt

```
This is Phase 08 QA of the Professions 2.0 feature: verify Stations and masters (sim and server).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 8 diff for correctness, missing tests, dead code, determinism, three-host
parity, and i18n completeness for THIS phase; fix what the audit finds; leave the phase provably
done.

STEP 0 - PRE-FLIGHT:
- Run `git status`: the working tree must be clean (a concurrent session may share the checkout).
  If it is not clean, stop and report.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries, at minimum:
  node25-breaks-jsdom-gate (run gate commands under Node 24), the PR 2039 professions state, and
  combo-recipes-broken-online (#2033: verify liveness, not just member shape, on any professions
  surface).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md (including the phase-start and
  phase-end commit hashes recorded in the Phase 8 notes)
- docs/professions-2/phase-08-stations-masters.md (deliverables, invariants, acceptance criteria,
  validation commands, and the phase-specific QA emphasis section of phase-08-qa.md)
- git diff <phase-start-commit>..HEAD --stat and the full diff of the professions, content, and
  tests files it names
The summary MUST return: every deliverable and acceptance criterion with its claimed status; the
list of files and new symbols the diff introduces (station registry module, StationType,
stationType recipe field, FIELD_RECIPES, deny reason id, the six master NPC ids, the placement
test file, the mobile-station wiring); the validation commands for this phase; and any diff hunk
that looks unrelated to the phase.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents. Give each ONLY the Explore summary plus its charge below.
Prompt every agent for COVERAGE, not filtering: report every gap with confidence and severity
(BLOCKING / SHOULD-FIX / NIT); filtering happens in STEP 3. If any agent's output arrives
truncated, re-spawn it with a narrower scope and merge results; never proceed on partial output.

Agent correctness deliverables:
- Verify EVERY deliverable and acceptance criterion in phase-08-stations-masters.md against the
  real code, not the phase session's claims.
- Run the phase's validation commands: npx tsc --noEmit; npx vitest run
  tests/professions_crafting_hub.test.ts tests/professions_crafting.test.ts
  tests/progression.test.ts plus the placement test; npx vitest run tests/architecture.test.ts;
  npx vitest run tests/localization_fixes.test.ts; npm run i18n:gen plus
  tests/i18n_completeness.test.ts if keys were added.
- Exercise the REAL behavior in a headless Sim harness, not just existing assertions: craft an
  uncommon+ recipe away from its station (expect the stable deny id), at the WRONG station type
  (expect deny), at the right station (expect success); craft each of the nine field recipes away
  from any station; activate a mobile station and craft through the gate, then let it expire and
  confirm the deny returns.
- Probe the phase-specific QA emphasis items: the CASTER_HUB_RECIPES migration (no regression
  against the old requiresHubStation behavior), the deny reason render path end to end (the
  as-landed craftResult-id form above, not a sim_i18n matcher), and
  FIELD_RECIPES exactness (exactly the pre-phase nine COMMON_RECIPES ids).
- Confirm the prime directive: every recipe craftable before the phase is still craftable at its
  station or in the field; nothing strands a mid-progress player.

Agent test-coverage deliverables:
- Find untested paths in the diff: the wrong-station-type deny, the proximity boundary (just
  inside vs just outside the station radius), mobile-station expiry, the placement buffer math,
  the FIELD_RECIPES set pin, the deny reason id contract.
- Add the missing tests, including a determinism test if sim logic changed (same seed, same
  world; the new NPCs and gate draw no rng and shift no draw order).
- Remove orphaned tests: stale requiresHubStation pins, superseded canUseCraftingHubStation
  assertions, any temporary mutation left in the placement test.

Agent dead-code-and-cleanup deliverables:
- Unused imports, types, and exports: requiresHubStation leftovers, dead CRAFTING_HUB_STATIONS
  consumers, duplicate station sources of truth.
- Sim purity: no DOM/Three/render/ui/game/net imports in src/sim/; all randomness through Rng;
  no Math.random, Date.now, or performance.now in the diff.
- Leftover TODOs, debug output, commented-out code; the mobile_station.ts header accurately
  describes the wired state; state.md and progress.md match what actually landed.

Also: spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows. Finish with the qa-checklist agent over the whole phase diff. Prompt all of them for
COVERAGE, not filtering; same truncation rule as above.

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX finding (NITs at your judgment; defer with a note if out of
  phase scope). Fix bugs test-first where a finding is a behavior bug.
- Rerun the STEP 2 validation commands until green.
- Commit with EXPLICIT paths (never git add -A), Conventional Commits with a scope and a body,
  for example fix(professions): <finding> or test(professions): <gap closed>.

STEP 4 - UPDATE DOCS + MEMORY:
- docs/professions-2/progress.md: mark the Phase 8 QA row, update mirrored checkboxes, append a
  note listing findings by severity and their outcomes.
- docs/professions-2/state.md: correct any Phase 8 surface entry the audit proved wrong; append
  QA-discovered surfaces.
- Record durable surprises (traps, contracts, tuning notes) to memory.

STEP 5 - FINAL RESPONSE FORMAT:
Report: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts (findings by severity: found, fixed,
deferred); validation results (each command, pass or fail); deferrals with owners and target
phases; and a one-line handoff for the Phase 9 session (station presence and training builds on
these registry and master surfaces).

STOPPING RULES:
- Stop IMMEDIATELY if the audit finds that any existing recipe became uncraftable for a player
  mid-progress; that is a FAIL verdict and a maintainer escalation, not a quiet fix.
- Stop if a fix would require changing a locked decision in state.md; ask first.
- No commit while any BLOCKING finding stands; if validation cannot go green without expanding
  scope beyond Phase 8, stop and report FAIL with the evidence.
```
