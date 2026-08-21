# Phase 6b: Release sync (the big-jump absorb)

A dedicated mid-phase that brings feature/farming-plan up to the NEWEST release/**
branch before Phase 6 QA. Every phase already opens by absorbing the newest release
tip, but this jump is two minor versions (v0.36.0 to v0.38.0 at authoring: 1453
commits, 2376 files, a 117-file intersection with the farming footprint, and a
lockfile move), far past anything a phase's STEP 0 should share a diff with. A sync
this size is its own deliverable: absorb, reconcile, re-prove, re-record, and land
NOTHING else. The standing rule this phase makes explicit for every future phase:
always fetch and absorb the newest release/** at phase start, and when the jump is
a minor version or more (or the intersection is triple digits), run this phase
file's shape as its own mid-phase instead of folding the absorb into feature work.

### Starter Prompt

```
This is Phase 6b of the Farming feature: Release sync to the newest release branch.
Model: Opus 4.8 or newer, xhigh effort (1m context variant where the file load
demands it).
Harness: Claude Code.
DELIVERY per D22 (standing): LOCAL-ONLY. No pushes, no PRs. The phase lands as
commits on fix/farming-sync-<version> cut off LOCAL feature/farming-plan, merges
back --no-ff, and deletes its branch. The gate log is the arbiter.

Goal: absorb the newest origin/release/** tip into the farming branch as its own
phase, heal every collision, re-prove every farming invariant, re-record every
baseline, and change NOTHING else. No feature work, no drive-by fixes outside
what the absorb itself forces.

SESSION FACTS (authored 2026-08-13; VERIFY then rely, and re-resolve the newest
tip at run time, which may have moved past these):
- Newest release at authoring: origin/release/v0.38.0 at 952c183fc3. Delta from
  the last absorbed tip 7ce12bad9e (the tenth absorb, Phase 6): 1453 commits,
  2376 files. True farming footprint: 222 files; intersection: 117 files.
- feature/farming-plan tip is 1a26881d0b (the Phase 6 merge). Golden:
  tests/parity/golden/farming_session.json md5
  bf00c277b89e142446550f00c1035696. NO golden may move in this phase; a moved
  golden is stop-and-surface, and a deliberate re-record needs a ledgered
  maintainer-grade reason.
- Count baselines going in (re-verify, then re-record whatever the absorb
  legitimately moves): command_schema 196/209 send/dispatch; IWorld 308 members
  (79 data, 229 method); delta keys 84; FARM_MATERIAL_ITEM_IDS 27 exact;
  ITEM_ART_PENDING 39 exact; farming.ts silent-loot grant sites 6; blob
  floor/ceiling 13952/15360 (verify the current pins in
  tests/professions_blob_growth.test.ts rather than trusting these numbers).
- pnpm-lock.yaml AND package.json moved in the release delta: the
  lockfile-moves-asset-seals trap FIRES (8 asset suites red, full-suite
  fallback forced). The heal is the 5-step size-preserving seal re-mint
  runbook (commit 218de2db08), never pin edits. Run pnpm install
  --frozen-lockfile after the merge; fresh worktrees and dependency moves need
  it before anything else runs.
- The release delta touches the (al)-healed art-program tooling:
  scripts/item_art_audit.mjs, scripts/build_mob_portrait_source_manifest.mjs,
  scripts/lib/mob_portrait_jobs.mjs, plus a NEW
  scripts/lib/mob_portrait_manifest_diff.mjs, plus BOTH accepted-art.json
  registries, plus scripts/gate_select.mjs itself. Expect real conflicts here
  and RECONCILE TOWARD THE RELEASE'S OWN MECHANISM: read the release-side diff
  of each of these FIRST; if the release solved pending-art exemption or
  fingerprint drift its own way, adopt its mechanism and re-express farming's
  needs (39 pending ids, fingerprint-only refresh) through it, keeping the
  branch-local (al) extensions only where the release still has nothing.
  Whatever survives, the state.md deviation (al) text must be updated to
  describe the RECONCILED mechanism, not the pre-sync one.
- Other known-hot intersection files (both sides changed since 7ce12bad9e):
  src/sim/sim.ts, src/sim/types.ts, src/sim/content/items.ts,
  src/sim/content/profession_items.ts, src/sim/content/deeds.ts,
  server/game.ts, server/db.ts, server/main.ts, src/net/online.ts,
  src/ui/hud.ts, src/ui/icons.ts, src/ui/char_window.ts, the i18n catalogs
  (items, hud_chrome, guide, merge) and deed_i18n locale overlays,
  tests/parity/scenarios.ts, tests/parity/coverage_c.test.ts,
  tests/world_api_parity.test.ts, tests/snapshots.test.ts,
  tests/command_schema.test.ts, tests/item_icons.test.ts,
  tests/mob_portrait_source_manifest.test.ts, scripts/wiki/build_content.mjs,
  src/guide/content.generated.ts.

TRAPS (verified across this program; do not relearn them):
- Run every gate as BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
  chrome-linux64/chrome node scripts/gate_select.mjs and judge ONLY the log
  markers ("[gate:select] PASS/FAIL" plus grep FAIL plus the exit marker); the
  shell exit code has lied. NOTE: the release changed gate_select.mjs, so
  re-read docs/qa-gate.md and the script header before the first run in case
  the markers or step list moved.
- NEVER edit the tree while a gate runs. Two Phase 6 gate runs were wasted on
  mid-edit artifacts. Freeze, commit, then gate.
- The full-suite fallback catches classes NO targeted list can see: census
  count pins AND evidence-digest pins over committed artifacts (six-plus
  strikes across five phases). Expect the absorb to trip several; heal
  test-first, one commit per healed class.
- Identical count-pin bumps auto-merge to a wrong total with no textual
  conflict: after the merge, RUN tests/world_api_parity.test.ts,
  tests/snapshots.test.ts, tests/command_schema.test.ts and the farming
  battery; never trust a clean merge of a pin file.
- When a release change makes a dormant farming surface live (or renames a
  surface farming pins), sweep tests/ for absence pins FIRST:
  grep -rl farming tests/ and read every literal list that names farming ids.
- ci:changed baseline drift: fetch origin +refs/heads/main:refs/remotes/origin/main
  first, capture the REAL exit code (no pipe through tail), and heal
  release-side findings as scoped reasoned commits, never whole-tree --write.
- Mutations and probes: commit first (struck four times); land with grep
  proof; require nonzero exit AND failing-test names; revert by checkout over
  committed files only.
- git -C ~/Documents/woc-farming-plan on EVERY git command; explicit paths on
  every commit, never git add -A; no session links or Claude attribution.
- If you fan out, every agent gets the delivery-discipline preamble ("your
  task is only successful if your FINAL message is the complete report; hard
  budget 30 tool calls, at 25 deliver; partial over none") and idle-without-
  report gets one SendMessage nudge; expect it (it is the default, not a
  failure).

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. git status
  must be clean; stop if not.
- git fetch origin --prune; re-resolve the NEWEST release branch:
  git branch -r --list 'origin/release/*' | sort -V, take the last row (v0.38.0
  at authoring; take whatever is newest NOW). Record its tip hash.
- Create branch fix/farming-sync-<version-slug> off LOCAL feature/farming-plan
  (NEVER off the release tip, which lacks the packet and all farming work).
  Record the phase-start commit.
- Scan Claude Code memory: MEMORY.md, farming-skill-program (the Phase 6 block
  carries the art-program evidence-pin traps this sync will hit again), plus
  lockfile-moves-asset-seals, biome-ci-changed-set-drifts,
  i18n-semantic-regressions-gate-trap, mutation-checks-commit-first,
  fanout-agent-delivery-traps, worktree-cwd-drift-misroutes-git. Read the
  state.md deviation (al) absorb checklist.

STEP 1 - MERGE AND RECONCILE
- Merge the newest release tip into the phase branch. Resolve conflicts by
  doctrine: generated artifacts (i18n.resolved.generated, translation_keys,
  content.generated, sfx manifests) are REGEN-RESOLVED via their owning build
  steps, never hand-merged; parity/count pin files prefer the release side
  then re-record by RUNNING the suites; both-sides-appended shapes (the
  scenarios.ts precedent) keep both blocks whole.
- For the art-program tooling conflicts, follow the reconcile-toward-release
  rule from the SESSION FACTS block, and re-run the guard suites
  (tests/item_art_audit_builder.test.ts, tests/item_art_consistency.test.ts,
  tests/mob_portrait_source_manifest.test.ts,
  tests/placeholder_art_completion.test.ts, tests/item_icons.test.ts) before
  calling any of them resolved.
- pnpm install --frozen-lockfile after the merge (the lockfile moved).
- Commit the merge with conflicts resolved before ANY probe or heal work.

STEP 2 - SEALS, ARTIFACTS, AND REGEN
- The asset seals: expect 8 suites red from the lockfile move; run the 5-step
  size-preserving re-mint runbook (218de2db08). Never edit a pin by hand.
- npm run i18n:gen and npm run wiki:content; commit regen deltas (byte-identical
  regen needs no commit; the gate's freshness arms are the check).
- node scripts/build_mob_portrait_source_manifest.mjs --write (or the
  release's evolved equivalent) and node scripts/item_art_audit.mjs
  --verify-only per the (al) absorb checklist; --refresh-verdict only if the
  evidence pins demand it, and note the sheet digests are environment-local.
- npm run ci:changed with the origin/main refetch; heal scoped.

STEP 3 - AUDIT
- Run the release-merge-audit skill over the merge commit (the 4-lane fan-out
  precedent: overlap reads, new surfaces/injected helpers/db mocks, premise
  drift, plus a lane for whatever this release's headline systems are).
- The PREMISE lane must sweep docs/farming/ itself: a 1453-commit release can
  invalidate Phase 7 to 13 premises (zone geography, seams, budget tables,
  monolith ceilings, tooling the phase files name). Every invalidated premise
  gets corrected in the phase file it lives in, IN THIS PHASE, with a line in
  state.md; that is this phase's version of "fix future prompts".
- Re-prove parity on the merged tree: full tests/parity/ run, golden md5
  unchanged, count baselines re-run and re-recorded.

STEP 4 - VALIDATION
- npx tsc --noEmit; the farming battery (farm_recipes, professions_farming,
  professions_farming_state, farm_patch_placement, farming_zones,
  farm_watch_fee, farming_view, professions_zone_rollout, material_taxonomy,
  material_profession_affinity, recipe_economy, item_icons,
  i18n_completeness, localization_fixes, guide, architecture); then the full
  gate (frozen tree, log markers). Expect the fallback to surface census and
  evidence classes the targeted lists cannot see; heal test-first and re-run
  the gate until "[gate:select] PASS" with zero unexplained FAIL lines.

STEP 5 - REVIEWS
- Dispatch cross-platform-sync (wire surfaces WILL have moved release-side;
  verify farming's fplot/commands/events still reconcile), architecture-reviewer
  (any hand-resolved src/sim conflict), and qa-checklist over the sync diff.
  Reviewers get the 30-call budget, the coverage instruction, and the resume
  line. No BLOCKING may stand at merge time.

STEP 6 - DOCS, LEDGERS, MEMORY
- state.md: new absorb header (version, tip, date, headline systems), the
  re-recorded baselines, the reconciled (al) text, and any new deviation
  letters continuing at (am). progress.md: the Phase 6b row and a Notes block
  (headline release systems absorbed, collisions healed with commits, baseline
  movements, premises corrected per phase file).
- phase-06-qa.md: confirm its diff map still stands (the sync merge lands
  AFTER 1a26881d0b and is EXCLUDED from the Phase 6 QA diff; it carries this
  phase's own audit) and note the sync merge hash there.
- Record surprises in Claude Code memory (farming-skill-program at minimum:
  the new absorb block, any new trap class).

STEP 7 - LAND AND REPORT
- Merge --no-ff into feature/farming-plan, delete the phase branch, smoke the
  merged tip (tsc + the farming battery + golden md5), and report: release
  systems absorbed; collisions healed (each with its commit); baselines before
  and after; premises corrected in which phase files; review verdicts;
  deferrals with owners; one-line handoff for Phase 6 QA.

STOPPING RULES
- Stop if any parity golden moves; surface the trace instead of re-recording.
- Stop if the seal re-mint runbook cannot hold sizes, or a release change
  guts a farming invariant (a ceiling the branch cannot satisfy, a removed
  seam farming rides); surface with numbers, never code around a locked
  decision (D1 to D24). state.md wins; contradictions get swept, not coded
  around.
- Stop if git status is dirty at STEP 0 or the newest release tip cannot be
  resolved.
- No feature work: if a heal starts growing into design, stop and surface.
```
