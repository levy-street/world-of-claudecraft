# Phase 04 QA: Verify Node materials and pristine veins

Independent audit of the Phase 04 diff: confirm node material tables, signed yields, the
per-node-type rare events (pristine vein, ancient heartwood, moonlit bloom), and the gather
feedback landed correctly, completely, and cleanly.

## QA Starter Prompt

```
This is Phase 04 QA of the Professions 2.0 feature: Verify Node materials and pristine
veins.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 04 diff for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for THIS phase, then fix what the audit finds.

STEP 0 - PRE-FLIGHT:
- Confirm `git status` is clean (a concurrent session may share the checkout).
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries: the node25 gate
  rule (run `npm run gate` under Node 24), PR 2039 state, and the design-language program
  (guardrails for the HUD loot-line touch).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-04-node-materials.md
- the git diff against the phase-start commit recorded in progress.md notes (fallback: the
  merge-base with the release branch)
The summary must return: every Phase 04 deliverable and acceptance criterion, the files the
phase touched, the phase's validation commands, the phase-specific QA emphasis items from
phase-04-qa.md, and any deferrals or re-pins the implementation session recorded.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents, each given only the Explore summary. Prompt every
agent for COVERAGE, not filtering: report every gap with confidence and severity
(BLOCKING / SHOULD-FIX / DEFERRABLE); the main session filters afterward. If any agent
reply comes back truncated, resume that agent and have it continue from where it stopped;
do not restart completed work.

AS-LANDED DEVIATIONS (2026-07-18, verify against these, not the older wording below):
- The harvest SFX cue rides the grant hub's own `loot` SimEvent, NOT the `gatherResult`
  case: the first draft double-logged and double-played (review catch), so the landed
  `gatherResult` case renders only the rarity-colored "You gather:" line
  (hudChrome.gathering.gatherLine/gatherLineQty, worded apart from the loot family) and
  adds no second cue; a pin in tests/gather_event_i18n.test.ts enforces both. "Drives the
  HUD log line and cue" therefore means: the line from gatherResult, the cue from the same
  harvest's loot event, plus the finder-only achievement cue on gatherRareEvent.
- There are NO sim_i18n/server_i18n matcher rows for the three broadcasts, deliberately:
  the events are text-free and id-based (the craftResult/skinEvent precedent), so no
  English leaves the sim and the S3 scan list is unchanged. The localization surface is
  the client-side gatherEvent.* catalog keys plus overlay fills, pinned by
  tests/gather_event_i18n.test.ts (existence, exact English, placeholder splices, hud
  switch liveness, flavor-to-key mapping). Read "matcher rows" below as those pins.
- Commit cadence landed as four commits, not three: the open-gate fix first, then tables
  AND the rare-event module together (gathering.ts imports the module, so splitting them
  leaves an unbuildable commit), then the parity golden alone (tests/parity convention),
  then the HUD/i18n commit.

Agent correctness:
- Verify every deliverable and acceptance criterion against the real code, not the phase
  summary: per-node-type tables keyed by rolled rarity, zone-appropriate tiers, rare+
  signing matching the corpse precedent, the rare-event cadence/yield/signing across all
  three flavors (pristine vein, ancient heartwood, moonlit bloom), the per-flavor
  broadcasts, the deed hooks, the loot line and cue.
- Run the phase validation commands:
  npx tsc --noEmit
  npx vitest run tests/gather_node_harvest.test.ts tests/professions_rarity_roll.test.ts \
    tests/gathering.test.ts tests/localization_fixes.test.ts tests/architecture.test.ts
- Exercise the real behavior: in a seeded sim run, harvest nodes across rarities and zones,
  force EACH rare-event flavor through the pinned Rng path (ore, wood, and herb nodes), and
  confirm the signed payloads, the per-flavor broadcast ids and values, and that
  gatherResult drives the HUD log line and SFX cue.
- Probe the phase-specific QA emphasis items listed in this file.

Agent test coverage:
- Find untested paths: the event cadence bounds, the node-type-to-flavor mapping, the
  zone-1 tier cap, signing at exactly the rare boundary, the deed hook no-ops, matcher rows
  for all three broadcasts, and the loot line's quality-color mapping.
- Add missing tests, including a determinism test if sim logic changed and none pins the new
  draw order (same seed, same yields, rare-event roll included).
- Remove orphaned tests, especially any that still pin the old placeholder junk grants.

Agent dead code and cleanup:
- Unused imports/types, leftover placeholder table entries or constants, dead branches from
  the junk-grant removal.
- Sim purity: no DOM/Three/render/ui/game/net imports in src/sim/; no Math.random,
  Date.now, or performance.now in sim logic.
- Leftover TODOs. The per-flavor deed-mark hooks are the one sanctioned deferral: verify
  they are named, dormant hooks (not stray TODO comments) and that nothing else was left
  half wired.

Also spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md: check git diff --name-only and spawn ONLY
matching rows, plus the qa-checklist agent over the whole phase diff (the phase is claimed
complete). Prompt them for COVERAGE, not filtering, same as above.

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX finding; leave DEFERRABLE items as recorded
  deferrals with an owning phase.
- Rerun the phase validation commands until green; npm run ci:changed; format only changed
  files with a scoped npx @biomejs/biome check --write <file>.
- Commit fixes with explicit paths (never git add -A), Conventional Commits with a scope
  and a body (for example fix(professions): ... or test(professions): ...).

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md: Phase 4 QA row status and dates; correct the
  mirrored Phase 4 checkboxes if the audit changed their truth; append findings and
  deferrals to the notes section.
- Correct docs/professions-2/state.md if the audit changed any "New surfaces per phase"
  entry for Phase 4.
- Record surprises (flaky draws, matcher gaps, parity traps) to Claude Code memory.

STEP 5 - FINAL RESPONSE FORMAT:
- Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
- Counts: findings by severity (BLOCKING / SHOULD-FIX / DEFERRABLE) and how many of each
  were fixed in STEP 3.
- Deferrals with reasons and the phase that owns each.
- One-line handoff to the next phase session (Phase 05).

STOPPING RULES:
- None special for this phase. If a fix would contradict a locked decision in state.md,
  stop and report instead of improvising.
```

## Phase-specific QA emphasis

- Draw-order stability with the extra event roll: confirm the determinism pin covers the
  rare-event draw, that pre-existing seeded runs still reproduce, and that any re-pin of
  prior draws was deliberate and explained in a commit body, never silent.
- Junk items still exist as defs: `bone_fragments`, `linen_scrap`, and `spider_leg` remain
  valid ItemDefs (players hold them); only their node sources were removed. Verify catalog
  entries, icons, and English names are untouched.
- Zone-1 tables cap at low tiers: no zone 1 node can yield above the common/low tier band
  (the stockpiling mitigation locked in state.md), and a test pins it.
- Feedback fairness and i18n: the zone broadcast is id-based and matcher-localized (S3
  guard green); the loot line and cue are identical on every graphics tier and colored only
  through the existing quality token family.
