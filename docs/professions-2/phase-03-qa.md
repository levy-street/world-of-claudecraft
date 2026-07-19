# Phase 03 QA: Verify Host-parity bug fixes

Audit the Phase 03 parity fixes (trade instance carriage, corpse claims on the wire, combo-gating
liveness) for correctness, coverage, and cleanliness before Phase 4 builds on them.

## QA Starter Prompt

```
This is Phase 03 QA of the Professions 2.0 feature: Verify Host-parity bug fixes.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: Audit the Phase 03 implementation for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for this phase.

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean (the Phase 03 implementation should already be committed). If
  dirty, ask the user (a concurrent session may share this checkout).
- Memory scan (if you use Claude Code memory): check entries from the Phase 03 domain
  (suggested topics: combo-recipes-broken-online, the #2033 stub trap this phase closes;
  node25-breaks-jsdom-gate, run the gate under Node 24).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (the Phase 3 entry under "New surfaces per phase": the hcb wire
  key, the trade payload carriage path, the liveness test)
- docs/professions-2/progress.md (the Phase 3 deliverable checklist + acceptance criteria)
- docs/professions-2/phase-03-parity-bug-fixes.md (the implementation prompt: what was promised)
- The git diff against the Phase 03 start commit (git diff --name-only first, then the diffs of
  every file it lists)
- CLAUDE.md (root) + src/sim/CLAUDE.md, src/net/CLAUDE.md, server/CLAUDE.md,
  src/ui/hud/CLAUDE.md, tests/CLAUDE.md
The agent must return: the full list of Phase 03 deliverables and acceptance criteria, all new
and modified files, how the trade payload threading and the hcb key were actually implemented,
and any known issues or deferrals noted in progress.md.

STEP 2 - QA AUDIT (spawn three parallel agents using the Explore summary; prompt each for
COVERAGE not filtering: report every issue including low-severity and uncertain ones; ranking
happens in a later step):

Correctness agent:
- Verify every Phase 03 deliverable was actually implemented and every acceptance criterion in
  the phase prompt is met.
- Run the phase's validation commands: npx vitest run tests/trade.test.ts
  tests/snapshots.test.ts tests/bandwidth.test.ts tests/corpse_harvest_sim.test.ts
  tests/world_api_parity.test.ts, plus tests/env_protocol.test.ts, tests/architecture.test.ts,
  and npx tsc --noEmit.
- Exercise the real behavior, not just the tests: trade an enchanted + signed + masterwork
  instance both directions and inspect the granted payloads; claim a corpse and confirm the
  mirrored harvestClaimedBy reaches the picker filter.
- Phase-specific emphasis (probe each explicitly):
  - Partial-stack trades: an offer mixing fungible stacks with instanced items must grant the
    right payloads to the right items, with no payload duplicated onto a fungible grant and no
    instance flattened into a stack.
  - The hcb claim key under interest-scope edges: a corpse leaving and re-entering the ~120 yd
    interest radius must arrive with the correct claim state, and a claim change while the
    corpse is out of scope must not leave a stale mirror.
  - No snapshot bloat: hcb is sparse-emitted, absent when unclaimed (the snapshots.test.ts
    sparse-absence assertion is the pin), and tests/bandwidth.test.ts stays green without
    loosened budgets (it carries no hcb-specific scenario).
- Verify the offline Sim path and the online ClientWorld path behave identically for trades,
  corpse claims, and combo gating; check edge cases (empty trade, self-claimed corpse, a corpse
  claimed by the viewing player, cancelled trade returning instances intact).

Test coverage agent:
- Identify Phase 03 code paths without tests (both trade directions, the mixed offer, the hcb
  delta omission, the picker filter, the ClientWorld mirror).
- Add missing tests, including a determinism test (same seed, same result) if sim logic changed
  (trade grant ordering is sim logic).
- Update any existing tests broken by Phase 03; verify hcb's ABSENCE from ALL_DELTA_KEYS /
  TERSE_TO_IWORLD is the reviewed as-landed deviation (per-entity dynamicFields key, pinned by
  its round-trip suites; see the deviation note atop phase-03-parity-bug-fixes.md), not an
  accidental omission.
- Remove orphaned tests for replaced behavior (for example a test pinning the old
  payload-stripping trade or the hardcoded-null harvestClaimedBy).
- Verify assertions are decisive (they check payload field values and claim ids, not just "it
  runs").

Dead code and cleanup agent:
- Find unused imports, functions, and types left behind in src/sim/social/trade.ts,
  src/sim/bags.ts, server/game.ts, src/net/online.ts, and
  src/ui/hud/loot/loot_window_controller.ts.
- Verify sim purity holds: src/sim/ imports nothing from render/ui/game/net, no DOM or Three
  imports, no Math.random / Date.now / performance.now (tests/architecture.test.ts green).
- Remove commented-out code and resolve or file any leftover TODO/FIXME from the phase.
- Check naming consistency (hcb follows the prof/gprof/ncd/tfocus key conventions) and that no
  duplicate claim-filtering logic was left in the picker.

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only against the phase-start
commit and spawn ONLY the agents whose row matches, plus qa-checklist (this is the
phase-completion QA gate). Prompt every spawned agent for COVERAGE not filtering. Resume any
agent that truncates mid-analysis with: "Stop reading more files. Output the full report now
based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

STEP 3 - FIX:
Apply all BLOCKING and SHOULD-FIX items. Rerun the validation commands above (at minimum
npx tsc --noEmit plus the affected vitest files; the S3 guard
tests/localization_fixes.test.ts if any player text changed). Commit fixes with EXPLICIT
paths (never git add -A), Conventional Commits with a body, separate from the QA verdicts so
the history is reviewable.

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md (mark Phase 3 QA complete; note items deferred to
  follow-up).
- Update docs/professions-2/state.md (any drift discovered during QA, for example a pin
  location or payload field the implementation summary got wrong).
- If you use Claude Code memory, record any surprising rules learned during QA.

STEP 5 - FINAL RESPONSE FORMAT:
End your turn with: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts of BLOCKING /
SHOULD-FIX / NICE-TO-HAVE found and fixed, deferred items, and a one-line handoff for Phase 4.

STOPPING RULES:
- Stop and surface to the user if any BLOCKING item cannot be fixed without changing the phase
  scope (for example if truthful claims require a wire shape change beyond a delta-omitted
  key).
```

## Phase-specific QA emphasis

- Partial-stack trades: mixed fungible + instanced offers must grant correct payloads on the
  correct items in both directions; probe stack splits and cancelled trades.
- The hcb claim key under interest-scope edges: corpses crossing the interest radius must never
  show a stale or missing claim in `ClientWorld`.
- No snapshot bloat: `hcb` is sparse-emitted and absent when unclaimed (the `tests/snapshots.test.ts`
  sparse-absence assertion is the pin); `tests/bandwidth.test.ts` stays green without loosened
  budgets (no hcb-specific scenario lives there).
- Liveness, not shape: the combo-gating test must prove live `combo_eligibility` values flow
  through `ClientWorld`, not merely that the member exists (the #2033 trap).
