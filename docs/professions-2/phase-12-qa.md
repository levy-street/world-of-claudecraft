# Phase 12 QA: Verify Base tool tier gating

Audit the Phase 12 implementation (node tiers plus tool tier gating) for correctness, missing
tests, dead code, determinism, three-host parity, and i18n completeness.

## QA Starter Prompt

```
This is Phase 12 QA of the Professions 2.0 feature: Verify Base tool tier gating.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 12 implementation for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for this phase.

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean (the Phase 12 implementation should already be committed). If
  dirty, ask the user (a concurrent session may share this checkout).
- Memory scan: check the `MEMORY.md` index for entries relevant to this phase's domain.
  Suggested topics: node25-breaks-jsdom-gate (run the gate under Node 24),
  combo-recipes-broken-online (the 2033 stub trap: verify liveness in BOTH hosts).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (the Phase 12 entry: GatherNodeDef.tier, the bare-hands rule,
  owned-best semantics, denial reason ids and key namespace; the tool-effects PARKED rule)
- docs/professions-2/progress.md (Phase 12 deliverable checklist and acceptance criteria)
- docs/professions-2/phase-12-tool-gating.md (the implementation prompt: what was promised)
- Every file created or modified in Phase 12: run `git diff --name-only` against the
  phase-start commit (find it via the Phase 12 commits in `git log` or the progress.md note)
- CLAUDE.md (root) plus src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md,
  tests/CLAUDE.md
The agent should return: the full list of Phase 12 deliverables and acceptance criteria, all
new or modified files, the denial reason ids and their catalog keys, the tier assignment per
node def (pre-phase vs new), and any known issues noted in progress.md.

STEP 2 - QA AUDIT (spawn three parallel agents using the Explore summary; prompt each for
COVERAGE not filtering: report every issue including low-severity and uncertain ones; ranking
happens in a later step):

Correctness agent:
- Verify every Phase 12 deliverable was actually implemented and every acceptance criterion in
  the phase prompt is met.
- Run the phase's validation commands: `npx tsc --noEmit`;
  `npx vitest run tests/professions_tools.test.ts tests/gather_node_harvest.test.ts
  tests/gathering.test.ts tests/architecture.test.ts`; `npm run i18n:gen` then
  `npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts`.
- Exercise the real behavior, not just the tests: drive a bare-hands harvest of a tier-1 node,
  a denied harvest of a tier-3 vein with the localized reason, an unlocked harvest after adding
  a higher-tier pick to the bags, a rare corpse pull with and without the matching tool, and a
  higher fishing catch band with and without the rod.
- Verify the offline Sim path and the online ClientWorld path behave identically (liveness, not
  just member shape: the 2033 stub trap); denial reasons render localized in BOTH hosts.
- Check edge cases: empty bags, multiple tools of equal tier, a wrong-profession tool, a node
  with no tier authored (should be impossible if the field is required), boundary tiers.

Test coverage agent:
- Identify new code paths without tests (the gating branch in harvestNode, the rare-pull branch
  in harvestCorpse, the fishing band gate, the denial emission in each host).
- Add missing unit tests, including a determinism test (same seed, same result) if sim logic
  changed without one.
- Verify the lockout-prevention test really walks EVERY pre-phase node def rather than a
  sample, and that the retired no-op pin left no orphaned or weakened assertions behind.
- Update tests broken by Phase 12; remove orphaned tests for replaced behavior; verify test
  assertions are decisive, not just "it runs".

Dead code and cleanup agent:
- Find unused imports, functions, and types left behind by the wiring.
- Verify sim purity holds: src/sim/ imports nothing from render/ui/game/net, no DOM/Three
  imports, no Math.random / Date.now / performance.now (tests/architecture.test.ts).
- Verify the parked effect/recharge half of src/sim/professions/tools.ts gained NO callers and
  was NOT deleted (the state.md rule: dormant, not removed).
- Remove commented-out code; verify no unresolved TODO/FIXME items; check naming consistency
  with the rest of src/sim/professions/.

PHASE-SPECIFIC QA EMPHASIS (probe these specifically):
- The lockout-prevention invariant on EVERY pre-phase node: enumerate the node defs that
  existed before Phase 12 and prove each one still resolves as bare-hands harvestable; any
  single gated pre-phase node is a BLOCKING finding.
- Owned-best resolution with multiple tools: bags holding several matching tools pick the
  highest tier; a higher-tier tool for the WRONG profession never counts; resolution is per
  profession within one bag.
- Corpse rare-pull gating does not affect the claim: the claim resolution outcome is identical
  whether the rare pull succeeds, is denied, or the player owns no tool at all.
- Fairness and both-host denial: the tier requirement shown in the node tooltip and minimap
  ready-state is identical across graphics presets, and the denial reason is localized in both
  the offline Sim and the online ClientWorld.

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md (the one canonical copy). Check
`git diff --name-only` against the phase-start commit and spawn ONLY the agents whose row
matches, plus `qa-checklist` (this is the phase-completion QA gate). Prompt each for COVERAGE
not filtering. Resume any review agent that truncates mid-analysis with: "Stop reading more
files. Output the full report now. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

STEP 3 - FIX:
Apply all BLOCKING and SHOULD-FIX items. Rerun the validation commands above (at minimum
`npx tsc --noEmit` plus the four named vitest files, and the S3 i18n guard if player text
changed). Commit fixes separately from the QA verdicts so the history is reviewable, with
EXPLICIT paths (never `git add -A`), Conventional Commits with a body, no em dashes or emojis.

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md (mark Phase 12 QA complete; note items deferred to
  follow-up).
- Update docs/professions-2/state.md (any drift discovered during QA, e.g. denial id or key
  namespace corrections).
- Record any surprising rules learned during QA to memory for the next session.

STEP 5 - FINAL RESPONSE FORMAT:
End your turn with: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts of BLOCKING /
SHOULD-FIX / NICE-TO-HAVE found and fixed, deferred items, and a one-line handoff for the
Phase 13 implementation session.

STOPPING RULES:
- Stop and surface to the user if any BLOCKING item cannot be fixed without changing the phase
  scope.
- Stop immediately if fixing a finding would gate any pre-phase content behind a tool or would
  wire the parked tool-effect modules.
```
