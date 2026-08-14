# Phase 7 QA: Verify Render and juice

Independent verification of Phase 7 in a fresh session. The emphasis is visual truth:
the beds actually render at all four hubs with the right tints, growth stages actually
change on screen for the owning player and ONLY the owning player (the per-viewer model,
D3), and nothing in the render or SFX wiring violated the fairness, purity, or
generated-file invariants. The audit runs on the real dev client, not just the suites.

PHASE 7 OUTCOME AMENDMENT (2026-08-14, read before auditing; the full record
is progress.md Phase 7 and state.md deviations (ap) through (ax)):
- Judge the phase against the recorded deviations, not the packet sketch:
  farmNowMs on the facet ((ap), the maintainer read this QA should
  re-argue), the farmGrowthStage move + direct core import ((ar)), the
  farm_props/ exporter path ((as)), pad/collider NEITHER ((at)),
  render-side families/tints ((au)), the eager import + 0.5s uniform read
  cadence ((av)), the delve_interior_scheduler extraction and the 13700
  ceiling ((aw)), and the SFX choices incl. farmWithered sharing the
  harvest cue ((ax)). The asset-budget acceptance line is the DELTA bar
  ((aq)), never the literal green.
- Adapter API as landed: FarmPatchVisuals.sync(world, dt) and
  onFarmEvent(ev, viewerPid). Any doc or test snippet showing
  sync(plots, nowMs) is stale.
- DEFERRALS OWED TO THIS QA, from the phase's review round (all ledgered in
  progress.md Notes): the instanced-prop helper extraction (rule-of-three
  is MET across stations/gather_nodes/farm_patches), cloneMaterialWithHooks
  on the GLB material clones, synthetic coverage of the GLB-loaded adapter
  branch (the committed suites exercise the box-fallback path only), a
  two-tier BUILT fairness arm for the bed half (the committed arms are
  scans plus a stage-walk), and the releaseGltf residency note.
- Also verify on the live client: the offline-reload regrow asymmetry the
  parity review named (faithful to the re-anchor semantics, first visible
  this phase) renders sanely, and the wet-band darkening reads on the LOW
  preset.

### QA Starter Prompt

```
This is Phase 7 QA of the Farming feature: Verify Render and juice.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 7 for correctness, missing tests, dead code, determinism,
three-host parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists. The phase lands
  as local commits merged --no-ff into feature/farming-plan (progress.md
  records the merge hash and commit map); audit that merge's phase-side
  parent chain, EXCLUDING any release-sync absorb commits, which carry their
  own audit. QA fix commits land on a fix/farming-phase-07-qa branch off
  feature/farming-plan, merged back --no-ff. Read this file's PR wording
  below through that lens.]
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; git status must
  be clean. Check out the phase branch fix/farming-phase-07-render-and-juice (QA fix
  commits land on the phase PR).
- Identify the phase diff: the PR's commits against its base (git merge-base the PR
  branch with the release branch it was opened against, then diff that range). The
  release tip may have moved concurrently, so the diff is the PR's commits, never
  everything-since-phase-start. Stop if the diff cannot be identified cleanly.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry,
  pr-screenshot-browser-path (browser path, swiftshader flags, overlay traps),
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first,
  big-diff-reviewer-turn-budgets.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md; the
docs/farming/progress.md Phase 7 notes (including any recorded deviation); the
promises in docs/farming/phase-07-render-and-juice.md (Live-surface note,
deliverables, acceptance criteria, the documented collider or pad decision); and
git diff --name-only over the phase diff. The summary must return the acceptance
list verbatim, the file list, the SimEvent and cue names used, and any deviation the
phase recorded.

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Each gets a hard 30-tool-call budget and the
coverage instruction: "report every issue including low-severity and uncertain ones;
ranking happens later." If truncated, resume with: "Stop reading more files. Output
the full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Agent 1, correctness:
- Verify every deliverable and every acceptance criterion in the phase file is
  actually met, not just claimed.
- Verify the offline Sim and online ClientWorld paths behave identically: the
  renderer reads the same IWorldFarming members from both, and no farming render
  read exists on only one world.
- Drive the real dev client headless (npm run dev, the browser path and swiftshader
  flags from the pr-screenshot-browser-path memory entry) and verify the on-screen
  result, dismissing any first-run prompt overlays before clicking: beds render at
  all four hubs (eastbrook_vale, mirefen_marsh, thornpeak_heights, evergarden) with
  the correct biome tint at each; with dev commands (ALLOW_DEV_COMMANDS=1, dev
  only), plant and force growth on MY plots and verify the stage meshes change on
  screen, the wet-soil tint appears after planting, and the withered silhouette
  renders for a failed crop.
- Verify the per-viewer model: another player's plot state must not alter my scene.
  Check it at the pure-core level (the rebuild signature derives only from the
  viewing player's plots plus the static patch defs) and, where feasible, live with
  a second connected client.
- Verify the projection is the render source of truth per D3: the adapter derives
  the visual stage from the planted-at and ready-at fractions, the wet-soil tint
  from planted-at recency, and the withered look from the projection's derived
  status; confirm no dedicated stage, wet, or withered facet read was added to
  IWorldFarming.
- If the phase touched src/sim/ (a collider or pad row): run live headless-Sim
  probes via a throwaway vitest file driving real ticks with an injected ADVANCEABLE
  clock (the clock must advance now(); a frozen clock hangs), then delete the file
  and verify the tree is clean.
- Edge cases: a patch with zero planted plots, all plots withered, a plot state that
  arrives after the first scene build (the signature guard must catch it), and tier
  knob toggling mid-session (VFX shed, beds and stages do not).

Agent 2, test coverage:
- Every claimed behavior has a decisive assertion that fails on regression; no
  constant-self-comparison pins (the contract test's fingerprint pins must compare
  against committed literals, not values recomputed from the same source).
- Both arms of every either/all claim: tinted and untinted, withered and healthy,
  shed and unshed VFX, signature-change rebuild and signature-same skip.
- Orphaned or superseded tests removed; the RENDER_PURE_CORES registration is real
  (the suite actually imports and runs the core).
- Mutation checks are allowed only after committing the work first; verify the
  exporter determinism claim by running it twice and diffing bytes.

Agent 3, dead code and cleanup:
- Unused imports, types, and exports across the diff; no unresolved TODOs; naming
  consistency with the farming modules landed in Phases 1 to 6.
- The sim import invariant: src/sim/ imports nothing from render, ui, game, or net,
  and src/render/farm_patches.ts imports nothing from src/sim/ beyond the world_api
  facet.
- No hand-edits to generated files (media manifest, SFX manifest, runtime pack);
  regen commands reproduce them byte-identically.
- No leftover throwaway probe files, screenshots, or scratch scripts in the tree.

Then dispatch the Review Dispatch Matrix rows in
docs/farming/implementation-plan.md that match the phase diff (expected:
frontend-seam-reviewer; architecture-reviewer only if src/sim/ moved), plus
qa-checklist (the phase-completion gate). Same 30-call budget, coverage instruction,
and resume line for each.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first: reproduce with a failing
test, then the smallest change that turns it green. Run the docs/farming/state.md
validation matrix rows the diff demands. Land fixes as separate Conventional Commits
with explicit paths, never git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 7 QA row and a Notes block) and
docs/farming/state.md (any drift found: ledger corrections, decision records).
If a fix amended the phase file, sweep this QA twin in the same pass.

STEP 5 - FINAL RESPONSE FORMAT
Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL. Counts: findings found and findings
fixed, by severity. Deferrals with reasons. A one-line handoff for the Phase 8
session.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.

Close: re-run node scripts/gate_select.mjs after fixes (the armory browser red is
the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; PR CI is the
arbiter) and push the fix commits to the phase PR.
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
